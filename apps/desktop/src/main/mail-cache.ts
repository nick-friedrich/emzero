import { DatabaseSync } from 'node:sqlite';
import type {
  MailAddressSummary,
  MailFolderSummary,
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

export interface CachedFolderMessages {
  messages: MailMessageSummary[];
  total: number;
  syncedAt: string | null;
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
    const version = this.#database.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version >= 1) return;

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
}
