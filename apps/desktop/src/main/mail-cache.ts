import { DatabaseSync } from 'node:sqlite';
import type {
  MailAddressSummary,
  MailAttachmentSummary,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
} from '../shared/accounts.js';

interface FolderRow {
  path: string;
  name: string;
  parent_path: string;
  delimiter: string;
  special_use: string | null;
  selectable: number;
  message_count: number;
  synced_at: string | null;
  uid_validity: string | null;
  uid_next: number | null;
  highest_modseq: string | null;
}

interface MessageRow {
  folder_path: string;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  reference_ids: string;
  subject: string;
  sender_addresses: string;
  recipient_addresses: string;
  sent_at: string | null;
  received_at: string | null;
  unread: number;
  flagged: number;
  size: number | null;
}

interface MessageBodyRow {
  uid: number;
  message_id: string | null;
  subject: string;
  sender_addresses: string;
  recipient_addresses: string;
  cc_addresses: string;
  reply_to_addresses: string;
  sent_at: string | null;
  body_text: string;
  body_html: string | null;
  html_has_quoted_text: number;
  attachments: string;
}

export interface CachedFolderMessages {
  messages: MailMessageSummary[];
  total: number;
  syncedAt: string | null;
}

export interface FolderSyncState extends CachedFolderMessages {
  uidValidity: string | null;
  uidNext: number | null;
  highestModseq: string | null;
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export class MailCache {
  readonly #database: DatabaseSync;

  constructor(filename: string) {
    this.#database = new DatabaseSync(filename);
    this.#database.exec('PRAGMA foreign_keys = ON');
    this.#database.exec('PRAGMA journal_mode = WAL');
    this.#migrate();
  }

  #migrate(): void {
    let version = (this.#database.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;

    if (version < 1) {
      this.#database.exec(`
      BEGIN;
      CREATE TABLE folders (
        account_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_path TEXT NOT NULL,
        delimiter TEXT NOT NULL,
        special_use TEXT,
        selectable INTEGER NOT NULL,
        position INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT,
        PRIMARY KEY (account_id, path)
      ) STRICT;

      CREATE TABLE messages (
        account_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        in_reply_to TEXT,
        reference_ids TEXT NOT NULL,
        subject TEXT NOT NULL,
        sender_addresses TEXT NOT NULL,
        recipient_addresses TEXT NOT NULL,
        sent_at TEXT,
        received_at TEXT,
        unread INTEGER NOT NULL,
        flagged INTEGER NOT NULL,
        size INTEGER,
        PRIMARY KEY (account_id, folder_path, uid),
        FOREIGN KEY (account_id, folder_path)
          REFERENCES folders (account_id, path) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX messages_by_folder_date
        ON messages (account_id, folder_path, received_at DESC, sent_at DESC, uid DESC);
      CREATE INDEX messages_by_message_id ON messages (account_id, message_id);
      PRAGMA user_version = 1;
      COMMIT;
    `);
      version = 1;
    }

    if (version < 2) {
      this.#database.exec(`
        BEGIN;
        ALTER TABLE folders ADD COLUMN uid_validity TEXT;
        ALTER TABLE folders ADD COLUMN uid_next INTEGER;
        ALTER TABLE folders ADD COLUMN highest_modseq TEXT;

        CREATE TABLE message_bodies (
          account_id TEXT NOT NULL,
          folder_path TEXT NOT NULL,
          uid INTEGER NOT NULL,
          message_id TEXT,
          subject TEXT NOT NULL,
          sender_addresses TEXT NOT NULL,
          recipient_addresses TEXT NOT NULL,
          cc_addresses TEXT NOT NULL,
          reply_to_addresses TEXT NOT NULL,
          sent_at TEXT,
          body_text TEXT NOT NULL,
          body_html TEXT,
          html_has_quoted_text INTEGER NOT NULL,
          attachments TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (account_id, folder_path, uid),
          FOREIGN KEY (account_id, folder_path, uid)
            REFERENCES messages (account_id, folder_path, uid) ON DELETE CASCADE
        ) STRICT;

        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
  }

  close(): void {
    this.#database.close();
  }

  replaceFolders(accountId: string, folders: MailFolderSummary[]): void {
    const upsert = this.#database.prepare(`
      INSERT INTO folders (
        account_id, path, name, parent_path, delimiter, special_use, selectable, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, path) DO UPDATE SET
        name = excluded.name,
        parent_path = excluded.parent_path,
        delimiter = excluded.delimiter,
        special_use = excluded.special_use,
        selectable = excluded.selectable,
        position = excluded.position
    `);
    const existing = this.#database
      .prepare('SELECT path FROM folders WHERE account_id = ?')
      .all(accountId) as Array<{ path: string }>;
    const incomingPaths = new Set(folders.map((folder) => folder.path));
    const remove = this.#database.prepare(
      'DELETE FROM folders WHERE account_id = ? AND path = ?',
    );

    this.#database.exec('BEGIN');
    try {
      folders.forEach((folder, position) => {
        upsert.run(
          accountId,
          folder.path,
          folder.name,
          folder.parentPath,
          folder.delimiter,
          folder.specialUse,
          folder.selectable ? 1 : 0,
          position,
        );
      });
      for (const folder of existing) {
        if (!incomingPaths.has(folder.path)) remove.run(accountId, folder.path);
      }
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  listFolders(accountId: string): MailFolderSummary[] {
    const rows = this.#database
      .prepare(`
        SELECT path, name, parent_path, delimiter, special_use, selectable,
               message_count, synced_at
        FROM folders
        WHERE account_id = ?
        ORDER BY position
      `)
      .all(accountId) as unknown as FolderRow[];
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      parentPath: row.parent_path,
      delimiter: row.delimiter,
      specialUse: row.special_use,
      selectable: Boolean(row.selectable),
    }));
  }

  replaceRecentMessages(
    accountId: string,
    folderPath: string,
    messages: MailMessageSummary[],
    total: number,
    syncedAt = new Date().toISOString(),
  ): void {
    const upsert = this.#database.prepare(`
      INSERT INTO messages (
        account_id, folder_path, uid, message_id, in_reply_to, reference_ids, subject,
        sender_addresses, recipient_addresses, sent_at, received_at, unread, flagged, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, folder_path, uid) DO UPDATE SET
        message_id = excluded.message_id,
        in_reply_to = excluded.in_reply_to,
        reference_ids = excluded.reference_ids,
        subject = excluded.subject,
        sender_addresses = excluded.sender_addresses,
        recipient_addresses = excluded.recipient_addresses,
        sent_at = excluded.sent_at,
        received_at = excluded.received_at,
        unread = excluded.unread,
        flagged = excluded.flagged,
        size = excluded.size
    `);
    const updateFolder = this.#database.prepare(`
      UPDATE folders SET message_count = ?, synced_at = ?
      WHERE account_id = ? AND path = ?
    `);
    const removeAll = this.#database.prepare(
      'DELETE FROM messages WHERE account_id = ? AND folder_path = ?',
    );
    const removeRecent = this.#database.prepare(`
      DELETE FROM messages
      WHERE account_id = ? AND folder_path = ? AND uid >= ?
    `);

    this.#database.exec('BEGIN');
    try {
      if (messages.length === 0) {
        removeAll.run(accountId, folderPath);
      } else {
        const minimumUid = Math.min(...messages.map((message) => message.uid));
        removeRecent.run(accountId, folderPath, minimumUid);
        for (const message of messages) {
          upsert.run(
            accountId,
            folderPath,
            message.uid,
            message.messageId,
            message.inReplyTo,
            JSON.stringify(message.references),
            message.subject,
            JSON.stringify(message.from),
            JSON.stringify(message.to),
            message.sentAt,
            message.receivedAt,
            message.unread ? 1 : 0,
            message.flagged ? 1 : 0,
            message.size,
          );
        }
      }
      updateFolder.run(total, syncedAt, accountId, folderPath);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  listMessages(accountId: string, folderPath: string): CachedFolderMessages {
    const folder = this.#database
      .prepare(`
        SELECT message_count, synced_at FROM folders
        WHERE account_id = ? AND path = ?
      `)
      .get(accountId, folderPath) as Pick<FolderRow, 'message_count' | 'synced_at'> | undefined;
    const rows = this.#database
      .prepare(`
        SELECT folder_path, uid, message_id, in_reply_to, reference_ids, subject,
               sender_addresses, recipient_addresses, sent_at, received_at,
               unread, flagged, size
        FROM messages
        WHERE account_id = ? AND folder_path = ?
        ORDER BY COALESCE(received_at, sent_at) DESC, uid DESC
      `)
      .all(accountId, folderPath) as unknown as MessageRow[];

    return {
      messages: rows.map((row) => ({
        folderPath: row.folder_path,
        uid: row.uid,
        messageId: row.message_id,
        inReplyTo: row.in_reply_to,
        references: parseJsonArray<string>(row.reference_ids),
        subject: row.subject,
        from: parseJsonArray<MailAddressSummary>(row.sender_addresses),
        to: parseJsonArray<MailAddressSummary>(row.recipient_addresses),
        sentAt: row.sent_at,
        receivedAt: row.received_at,
        unread: Boolean(row.unread),
        flagged: Boolean(row.flagged),
        size: row.size,
      })),
      total: folder?.message_count ?? 0,
      syncedAt: folder?.synced_at ?? null,
    };
  }

  getFolderSyncState(accountId: string, folderPath: string): FolderSyncState {
    const messages = this.listMessages(accountId, folderPath);
    const folder = this.#database
      .prepare(`
        SELECT uid_validity, uid_next, highest_modseq
        FROM folders WHERE account_id = ? AND path = ?
      `)
      .get(accountId, folderPath) as
      | Pick<FolderRow, 'uid_validity' | 'uid_next' | 'highest_modseq'>
      | undefined;
    return {
      ...messages,
      uidValidity: folder?.uid_validity ?? null,
      uidNext: folder?.uid_next ?? null,
      highestModseq: folder?.highest_modseq ?? null,
    };
  }

  listMessageUids(accountId: string, folderPath: string): number[] {
    return (
      this.#database
        .prepare(`
          SELECT uid FROM messages
          WHERE account_id = ? AND folder_path = ?
          ORDER BY uid
        `)
        .all(accountId, folderPath) as unknown as Array<{ uid: number }>
    ).map(({ uid }) => uid);
  }

  applyIncrementalSync(
    accountId: string,
    folderPath: string,
    messages: MailMessageSummary[],
    remoteUids: number[],
    metadata: {
      uidValidity: string;
      uidNext: number;
      highestModseq: string | null;
      syncedAt?: string;
    },
  ): void {
    const currentState = this.getFolderSyncState(accountId, folderPath);
    const reset = currentState.uidValidity !== null && currentState.uidValidity !== metadata.uidValidity;
    const remoteUidSet = new Set(remoteUids);
    const remove = this.#database.prepare(`
      DELETE FROM messages WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    const upsert = this.#database.prepare(`
      INSERT INTO messages (
        account_id, folder_path, uid, message_id, in_reply_to, reference_ids, subject,
        sender_addresses, recipient_addresses, sent_at, received_at, unread, flagged, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, folder_path, uid) DO UPDATE SET
        message_id = excluded.message_id,
        in_reply_to = excluded.in_reply_to,
        reference_ids = excluded.reference_ids,
        subject = excluded.subject,
        sender_addresses = excluded.sender_addresses,
        recipient_addresses = excluded.recipient_addresses,
        sent_at = excluded.sent_at,
        received_at = excluded.received_at,
        unread = excluded.unread,
        flagged = excluded.flagged,
        size = excluded.size
    `);
    const resetMessages = this.#database.prepare(
      'DELETE FROM messages WHERE account_id = ? AND folder_path = ?',
    );
    const updateFolder = this.#database.prepare(`
      UPDATE folders
      SET message_count = ?, synced_at = ?, uid_validity = ?, uid_next = ?, highest_modseq = ?
      WHERE account_id = ? AND path = ?
    `);

    this.#database.exec('BEGIN');
    try {
      if (reset) resetMessages.run(accountId, folderPath);
      else {
        for (const uid of this.listMessageUids(accountId, folderPath)) {
          if (!remoteUidSet.has(uid)) remove.run(accountId, folderPath, uid);
        }
      }
      for (const message of messages) {
        upsert.run(
          accountId,
          folderPath,
          message.uid,
          message.messageId,
          message.inReplyTo,
          JSON.stringify(message.references),
          message.subject,
          JSON.stringify(message.from),
          JSON.stringify(message.to),
          message.sentAt,
          message.receivedAt,
          message.unread ? 1 : 0,
          message.flagged ? 1 : 0,
          message.size,
        );
      }
      updateFolder.run(
        remoteUids.length,
        metadata.syncedAt ?? new Date().toISOString(),
        metadata.uidValidity,
        metadata.uidNext,
        metadata.highestModseq,
        accountId,
        folderPath,
      );
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  getMessageBody(
    accountId: string,
    folderPath: string,
    uid: number,
  ): MailMessageDetail | null {
    const row = this.#database
      .prepare(`
        SELECT uid, message_id, subject, sender_addresses, recipient_addresses,
               cc_addresses, reply_to_addresses, sent_at, body_text, body_html,
               html_has_quoted_text, attachments
        FROM message_bodies
        WHERE account_id = ? AND folder_path = ? AND uid = ?
      `)
      .get(accountId, folderPath, uid) as MessageBodyRow | undefined;
    if (!row) return null;
    return {
      uid: row.uid,
      messageId: row.message_id,
      subject: row.subject,
      from: parseJsonArray<MailAddressSummary>(row.sender_addresses),
      to: parseJsonArray<MailAddressSummary>(row.recipient_addresses),
      cc: parseJsonArray<MailAddressSummary>(row.cc_addresses),
      replyTo: parseJsonArray<MailAddressSummary>(row.reply_to_addresses),
      sentAt: row.sent_at,
      text: row.body_text,
      html: row.body_html,
      htmlHasQuotedText: Boolean(row.html_has_quoted_text),
      attachments: parseJsonArray<MailAttachmentSummary>(row.attachments),
    };
  }

  putMessageBody(
    accountId: string,
    folderPath: string,
    message: MailMessageDetail,
  ): void {
    this.#database
      .prepare(`
        INSERT INTO message_bodies (
          account_id, folder_path, uid, message_id, subject, sender_addresses,
          recipient_addresses, cc_addresses, reply_to_addresses, sent_at, body_text,
          body_html, html_has_quoted_text, attachments, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (account_id, folder_path, uid) DO UPDATE SET
          message_id = excluded.message_id,
          subject = excluded.subject,
          sender_addresses = excluded.sender_addresses,
          recipient_addresses = excluded.recipient_addresses,
          cc_addresses = excluded.cc_addresses,
          reply_to_addresses = excluded.reply_to_addresses,
          sent_at = excluded.sent_at,
          body_text = excluded.body_text,
          body_html = excluded.body_html,
          html_has_quoted_text = excluded.html_has_quoted_text,
          attachments = excluded.attachments,
          fetched_at = excluded.fetched_at
      `)
      .run(
        accountId,
        folderPath,
        message.uid,
        message.messageId,
        message.subject,
        JSON.stringify(message.from),
        JSON.stringify(message.to),
        JSON.stringify(message.cc),
        JSON.stringify(message.replyTo),
        message.sentAt,
        message.text,
        message.html,
        message.htmlHasQuotedText ? 1 : 0,
        JSON.stringify(message.attachments),
        new Date().toISOString(),
      );
  }
}
