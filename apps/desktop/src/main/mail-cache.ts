import { DatabaseSync } from 'node:sqlite';
import type {
  MailAddressSummary,
  MailAttachmentSummary,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailSearchItem,
  RecipientSuggestion,
} from '../shared/accounts.js';

interface FolderRow {
  path: string;
  name: string;
  parent_path: string;
  delimiter: string;
  special_use: string | null;
  selectable: number;
  unread_count: number;
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

interface CorrespondentRow {
  name: string | null;
  address: string | null;
  observed_at: string | null;
  outgoing: number;
}

interface SearchRow extends MessageRow {
  account_id: string;
  folder_name: string;
  folder_parent_path: string;
  folder_delimiter: string;
  folder_special_use: string | null;
  folder_selectable: number;
  folder_unread_count: number;
  snippet: string | null;
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
      version = 2;
    }

    if (version < 3) {
      this.#database.exec(`
        BEGIN;
        ALTER TABLE folders ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
        UPDATE folders
        SET unread_count = (
          SELECT COUNT(*)
          FROM messages
          WHERE messages.account_id = folders.account_id
            AND messages.folder_path = folders.path
            AND messages.unread = 1
        );
        PRAGMA user_version = 3;
        COMMIT;
      `);
      version = 3;
    }

    if (version < 4) {
      this.#database.exec(`
        BEGIN;
        CREATE VIRTUAL TABLE message_search USING fts5(
          account_id UNINDEXED,
          folder_path UNINDEXED,
          uid UNINDEXED,
          subject,
          sender_addresses,
          recipient_addresses,
          body_text,
          tokenize = 'unicode61 remove_diacritics 2'
        );

        INSERT INTO message_search (
          account_id, folder_path, uid, subject, sender_addresses, recipient_addresses, body_text
        )
        SELECT messages.account_id, messages.folder_path, messages.uid, messages.subject,
               messages.sender_addresses, messages.recipient_addresses,
               COALESCE(message_bodies.body_text, '')
        FROM messages
        LEFT JOIN message_bodies
          ON message_bodies.account_id = messages.account_id
         AND message_bodies.folder_path = messages.folder_path
         AND message_bodies.uid = messages.uid;

        CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
          INSERT INTO message_search (
            account_id, folder_path, uid, subject, sender_addresses, recipient_addresses, body_text
          ) VALUES (
            new.account_id, new.folder_path, new.uid, new.subject,
            new.sender_addresses, new.recipient_addresses, ''
          );
        END;

        CREATE TRIGGER messages_search_update
        AFTER UPDATE OF subject, sender_addresses, recipient_addresses ON messages BEGIN
          DELETE FROM message_search
          WHERE account_id = old.account_id AND folder_path = old.folder_path AND uid = old.uid;
          INSERT INTO message_search (
            account_id, folder_path, uid, subject, sender_addresses, recipient_addresses, body_text
          )
          SELECT new.account_id, new.folder_path, new.uid, new.subject,
                 new.sender_addresses, new.recipient_addresses,
                 COALESCE(message_bodies.body_text, '')
          FROM (SELECT 1)
          LEFT JOIN message_bodies
            ON message_bodies.account_id = new.account_id
           AND message_bodies.folder_path = new.folder_path
           AND message_bodies.uid = new.uid;
        END;

        CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
          DELETE FROM message_search
          WHERE account_id = old.account_id AND folder_path = old.folder_path AND uid = old.uid;
        END;

        CREATE TRIGGER message_bodies_search_insert AFTER INSERT ON message_bodies BEGIN
          DELETE FROM message_search
          WHERE account_id = new.account_id AND folder_path = new.folder_path AND uid = new.uid;
          INSERT INTO message_search (
            account_id, folder_path, uid, subject, sender_addresses, recipient_addresses, body_text
          )
          SELECT messages.account_id, messages.folder_path, messages.uid, messages.subject,
                 messages.sender_addresses, messages.recipient_addresses, new.body_text
          FROM messages
          WHERE messages.account_id = new.account_id
            AND messages.folder_path = new.folder_path
            AND messages.uid = new.uid;
        END;

        CREATE TRIGGER message_bodies_search_update AFTER UPDATE OF body_text ON message_bodies BEGIN
          DELETE FROM message_search
          WHERE account_id = new.account_id AND folder_path = new.folder_path AND uid = new.uid;
          INSERT INTO message_search (
            account_id, folder_path, uid, subject, sender_addresses, recipient_addresses, body_text
          )
          SELECT messages.account_id, messages.folder_path, messages.uid, messages.subject,
                 messages.sender_addresses, messages.recipient_addresses, new.body_text
          FROM messages
          WHERE messages.account_id = new.account_id
            AND messages.folder_path = new.folder_path
            AND messages.uid = new.uid;
        END;

        PRAGMA user_version = 4;
        COMMIT;
      `);
      version = 4;
    }

    if (version < 5) {
      this.#database.exec(`
        BEGIN;
        -- HTML used to be cached after remote image sources were removed.
        -- Re-fetch bodies on demand so the renderer can apply its own CSP.
        DELETE FROM message_bodies;
        PRAGMA user_version = 5;
        COMMIT;
      `);
      version = 5;
    }

    if (version < 6) {
      this.#database.exec(`
        BEGIN;
        -- Link destinations used to be removed during HTML sanitization.
        -- Re-fetch bodies so safe HTTP(S) links can request browser opening.
        DELETE FROM message_bodies;
        PRAGMA user_version = 6;
        COMMIT;
      `);
    }
  }

  close(): void {
    this.#database.close();
  }

  deleteAccount(accountId: string): void {
    this.#database.prepare('DELETE FROM folders WHERE account_id = ?').run(accountId);
  }

  replaceFolders(accountId: string, folders: MailFolderSummary[]): void {
    const upsert = this.#database.prepare(`
      INSERT INTO folders (
        account_id, path, name, parent_path, delimiter, special_use, selectable, unread_count, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, path) DO UPDATE SET
        name = excluded.name,
        parent_path = excluded.parent_path,
        delimiter = excluded.delimiter,
        special_use = excluded.special_use,
        selectable = excluded.selectable,
        unread_count = excluded.unread_count
    `);
    const existing = this.#database
      .prepare('SELECT path, position FROM folders WHERE account_id = ?')
      .all(accountId) as Array<{ path: string; position: number }>;
    const existingPaths = new Set(existing.map((folder) => folder.path));
    let nextPosition = existing.reduce(
      (maximum, folder) => Math.max(maximum, folder.position + 1),
      0,
    );
    const incomingPaths = new Set(folders.map((folder) => folder.path));
    const remove = this.#database.prepare(
      'DELETE FROM folders WHERE account_id = ? AND path = ?',
    );

    this.#database.exec('BEGIN');
    try {
      folders.forEach((folder, serverPosition) => {
        upsert.run(
          accountId,
          folder.path,
          folder.name,
          folder.parentPath,
          folder.delimiter,
          folder.specialUse,
          folder.selectable ? 1 : 0,
          folder.unreadCount,
          existingPaths.has(folder.path) ? serverPosition : nextPosition++,
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
        SELECT path, name, parent_path, delimiter, special_use, selectable, unread_count,
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
      unreadCount: row.unread_count,
    }));
  }

  reorderFolderSiblings(
    accountId: string,
    parentPath: string,
    orderedPaths: string[],
  ): void {
    const siblingPaths = new Set(
      (
        this.#database
          .prepare('SELECT path FROM folders WHERE account_id = ? AND parent_path = ?')
          .all(accountId, parentPath) as Array<{ path: string }>
      ).map(({ path }) => path),
    );
    if (
      orderedPaths.length !== siblingPaths.size ||
      new Set(orderedPaths).size !== orderedPaths.length ||
      orderedPaths.some((path) => !siblingPaths.has(path))
    ) {
      throw new Error('Folder order does not match the destination.');
    }
    const update = this.#database.prepare(
      'UPDATE folders SET position = ? WHERE account_id = ? AND path = ?',
    );
    this.#database.exec('BEGIN');
    try {
      orderedPaths.forEach((path, position) => update.run(position, accountId, path));
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
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

  searchMessages(
    query: string,
    filters: {
      accountId?: string;
      folderPath?: string;
      limit?: number;
      sort?: 'relevance' | 'newest' | 'oldest';
    } = {},
  ): MailSearchItem[] {
    const tokens = query.trim().match(/[\p{L}\p{N}@._+-]+/gu) ?? [];
    if (tokens.length === 0) return [];
    const matchQuery = tokens
      .slice(0, 12)
      .map((token) => `"${token.replaceAll('"', '""')}"*`)
      .join(' AND ');
    const clauses = ['message_search MATCH ?'];
    const parameters: Array<string | number> = [matchQuery];
    if (filters.accountId) {
      clauses.push('messages.account_id = ?');
      parameters.push(filters.accountId);
    }
    if (filters.folderPath) {
      clauses.push('messages.folder_path = ?');
      parameters.push(filters.folderPath);
    }
    parameters.push(Math.max(1, Math.min(filters.limit ?? 100, 200)));
    const orderBy =
      filters.sort === 'newest'
        ? 'COALESCE(messages.received_at, messages.sent_at) DESC, messages.uid DESC'
        : filters.sort === 'oldest'
          ? 'COALESCE(messages.received_at, messages.sent_at) ASC, messages.uid ASC'
          : `bm25(message_search, 0, 0, 0, 10, 7, 4, 1),
             COALESCE(messages.received_at, messages.sent_at) DESC`;

    const rows = this.#database
      .prepare(`
        SELECT messages.account_id, messages.folder_path, messages.uid, messages.message_id,
               messages.in_reply_to, messages.reference_ids, messages.subject,
               messages.sender_addresses, messages.recipient_addresses, messages.sent_at,
               messages.received_at, messages.unread, messages.flagged, messages.size,
               folders.name AS folder_name, folders.parent_path AS folder_parent_path,
               folders.delimiter AS folder_delimiter, folders.special_use AS folder_special_use,
               folders.selectable AS folder_selectable,
               folders.unread_count AS folder_unread_count,
               NULLIF(snippet(message_search, 6, '', '', ' … ', 24), '') AS snippet
        FROM message_search
        JOIN messages
          ON messages.account_id = message_search.account_id
         AND messages.folder_path = message_search.folder_path
         AND messages.uid = CAST(message_search.uid AS INTEGER)
        JOIN folders
          ON folders.account_id = messages.account_id
         AND folders.path = messages.folder_path
        WHERE ${clauses.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT ?
      `)
      .all(...parameters) as unknown as SearchRow[];

    return rows.map((row) => ({
      accountId: row.account_id,
      folder: {
        path: row.folder_path,
        name: row.folder_name,
        parentPath: row.folder_parent_path,
        delimiter: row.folder_delimiter,
        specialUse: row.folder_special_use,
        selectable: Boolean(row.folder_selectable),
        unreadCount: row.folder_unread_count,
      },
      message: {
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
      },
      snippet: row.snippet,
    }));
  }

  searchRecipients(
    accountId: string,
    query: string,
    excludedAddresses: string[] = [],
    limit = 8,
  ): RecipientSuggestion[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    const rows = this.#database
      .prepare(`
        SELECT json_extract(address.value, '$.name') AS name,
               json_extract(address.value, '$.address') AS address,
               COALESCE(messages.sent_at, messages.received_at) AS observed_at,
               1 AS outgoing
        FROM messages
        JOIN folders ON folders.account_id = messages.account_id
                    AND folders.path = messages.folder_path
        JOIN json_each(messages.recipient_addresses) AS address
        WHERE messages.account_id = ?
          AND folders.special_use = '\\Sent'
          AND (instr(lower(COALESCE(json_extract(address.value, '$.address'), '')), ?) > 0
            OR instr(lower(COALESCE(json_extract(address.value, '$.name'), '')), ?) > 0)
        UNION ALL
        SELECT json_extract(address.value, '$.name') AS name,
               json_extract(address.value, '$.address') AS address,
               COALESCE(messages.received_at, messages.sent_at) AS observed_at,
               0 AS outgoing
        FROM messages
        JOIN folders ON folders.account_id = messages.account_id
                    AND folders.path = messages.folder_path
        JOIN json_each(messages.sender_addresses) AS address
        WHERE messages.account_id = ?
          AND COALESCE(folders.special_use, '') != '\\Sent'
          AND (instr(lower(COALESCE(json_extract(address.value, '$.address'), '')), ?) > 0
            OR instr(lower(COALESCE(json_extract(address.value, '$.name'), '')), ?) > 0)
      `)
      .all(
        accountId,
        normalizedQuery,
        normalizedQuery,
        accountId,
        normalizedQuery,
        normalizedQuery,
      ) as unknown as CorrespondentRow[];
    const excluded = new Set(excludedAddresses.map((address) => address.trim().toLowerCase()));
    const correspondents = new Map<
      string,
      { name: string | null; lastUsedAt: number; outgoing: number; incoming: number }
    >();
    for (const row of rows) {
      const address = row.address?.trim().toLowerCase() ?? '';
      if (!address || excluded.has(address)) continue;
      const observedAt = row.observed_at ? Date.parse(row.observed_at) : 0;
      const current = correspondents.get(address) ?? {
        name: null,
        lastUsedAt: 0,
        outgoing: 0,
        incoming: 0,
      };
      if (row.name?.trim() && (!current.name || observedAt >= current.lastUsedAt)) {
        current.name = row.name.trim();
      }
      current.lastUsedAt = Math.max(current.lastUsedAt, observedAt || 0);
      if (row.outgoing) current.outgoing += 1;
      else current.incoming += 1;
      correspondents.set(address, current);
    }

    return [...correspondents.entries()]
      .sort(([leftAddress, left], [rightAddress, right]) => {
        const score = (address: string, value: typeof left) =>
          (address.startsWith(normalizedQuery) ? 1_000 : 0) +
          (value.name?.toLowerCase().startsWith(normalizedQuery) ? 700 : 0) +
          Math.min(value.outgoing, 20) * 20 +
          Math.min(value.incoming, 20) * 5;
        return score(rightAddress, right) - score(leftAddress, left) || right.lastUsedAt - left.lastUsedAt;
      })
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(([address, value]) => ({ name: value.name, address }));
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

  setMessagesUnread(
    accountId: string,
    folderPath: string,
    uids: number[],
    unread: boolean,
  ): void {
    const updateMessages = this.#database.prepare(`
      UPDATE messages SET unread = ?
      WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    const updateFolder = this.#database.prepare(`
      UPDATE folders SET unread_count = (
        SELECT COUNT(*) FROM messages
        WHERE account_id = ? AND folder_path = ? AND unread = 1
      )
      WHERE account_id = ? AND path = ?
    `);

    this.#database.exec('BEGIN');
    try {
      for (const uid of uids) {
        updateMessages.run(unread ? 1 : 0, accountId, folderPath, uid);
      }
      updateFolder.run(accountId, folderPath, accountId, folderPath);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  setMessagesFlagged(
    accountId: string,
    folderPath: string,
    uids: number[],
    flagged: boolean,
  ): void {
    const update = this.#database.prepare(`
      UPDATE messages SET flagged = ?
      WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    this.#database.exec('BEGIN');
    try {
      for (const uid of uids) update.run(flagged ? 1 : 0, accountId, folderPath, uid);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  invalidateFolder(accountId: string, folderPath: string): void {
    this.#database.prepare(`
      UPDATE folders
      SET synced_at = NULL, uid_validity = NULL, uid_next = NULL, highest_modseq = NULL
      WHERE account_id = ? AND path = ?
    `).run(accountId, folderPath);
  }

  deleteMessages(accountId: string, folderPath: string, uids: number[]): void {
    const remove = this.#database.prepare(`
      DELETE FROM messages WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    const updateFolder = this.#database.prepare(`
      UPDATE folders
      SET message_count = MAX(0, message_count - ?),
          unread_count = (
            SELECT COUNT(*) FROM messages
            WHERE account_id = ? AND folder_path = ? AND unread = 1
          )
      WHERE account_id = ? AND path = ?
    `);

    this.#database.exec('BEGIN');
    try {
      let removed = 0;
      for (const uid of uids) {
        removed += Number(remove.run(accountId, folderPath, uid).changes);
      }
      updateFolder.run(removed, accountId, folderPath, accountId, folderPath);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  moveMessages(
    accountId: string,
    folderPath: string,
    destinationPath: string,
    uids: number[],
  ): void {
    this.transferMessages(accountId, folderPath, accountId, destinationPath, uids);
  }

  transferMessages(
    sourceAccountId: string,
    sourcePath: string,
    destinationAccountId: string,
    destinationPath: string,
    uids: number[],
  ): void {
    const messageState = this.#database.prepare(`
      SELECT unread FROM messages
      WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    const remove = this.#database.prepare(`
      DELETE FROM messages WHERE account_id = ? AND folder_path = ? AND uid = ?
    `);
    const updateSource = this.#database.prepare(`
      UPDATE folders
      SET message_count = MAX(0, message_count - ?),
          unread_count = MAX(0, unread_count - ?)
      WHERE account_id = ? AND path = ?
    `);
    const invalidateDestination = this.#database.prepare(`
      UPDATE folders
      SET message_count = message_count + ?,
          unread_count = unread_count + ?,
          synced_at = NULL,
          uid_validity = NULL,
          uid_next = NULL,
          highest_modseq = NULL
      WHERE account_id = ? AND path = ?
    `);

    this.#database.exec('BEGIN');
    try {
      let moved = 0;
      let unread = 0;
      for (const uid of uids) {
        const row = messageState.get(sourceAccountId, sourcePath, uid) as
          | Pick<MessageRow, 'unread'>
          | undefined;
        if (!row) continue;
        moved += Number(remove.run(sourceAccountId, sourcePath, uid).changes);
        unread += row.unread;
      }
      updateSource.run(moved, unread, sourceAccountId, sourcePath);
      invalidateDestination.run(
        moved,
        unread,
        destinationAccountId,
        destinationPath,
      );
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
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
      reconcile?: boolean;
      messageCount?: number;
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
      else if (metadata.reconcile !== false) {
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
      const reconciledAt = metadata.syncedAt ?? new Date().toISOString();
      const messageCount = metadata.reconcile === false
        ? (metadata.messageCount ?? Math.max(currentState.total, remoteUids.length))
        : remoteUids.length;
      updateFolder.run(
        messageCount,
        metadata.reconcile === false ? currentState.syncedAt : reconciledAt,
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
