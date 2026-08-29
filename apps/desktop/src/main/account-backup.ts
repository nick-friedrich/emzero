import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  randomUUID,
} from 'node:crypto';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dialog, safeStorage } from 'electron';
import type { AccountBackupResult } from '../shared/accounts.js';
import { readAccounts, toAccountSummary, writeAccounts, type StoredAccount } from './account-storage.js';

const scrypt = promisify(scryptCallback);
const FORMAT = 'emzero-account-backup';
const VERSION = 1;
const KEY_LENGTH = 32;
const selectedBackups = new Map<string, string>();

interface PortableAccount extends Omit<StoredAccount, 'encryptedSecret'> {
  secret?: string;
}

interface BackupPayload {
  exportedAt: string;
  accounts: PortableAccount[];
}

interface BackupEnvelope {
  format: typeof FORMAT;
  version: typeof VERSION;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

const decode = (value: string) => Buffer.from(value, 'base64');

export async function encryptBackup(payload: BackupPayload, password: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const envelope: BackupEnvelope = {
    format: FORMAT,
    version: VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export async function decryptBackup(contents: string, password: string): Promise<BackupPayload> {
  const envelope = JSON.parse(contents) as Partial<BackupEnvelope>;
  if (
    envelope.format !== FORMAT ||
    envelope.version !== VERSION ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.authTag !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) throw new Error('This is not a supported Emzero account backup.');
  const key = (await scrypt(password, decode(envelope.salt), KEY_LENGTH)) as Buffer;
  const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.iv));
  decipher.setAuthTag(decode(envelope.authTag));
  const plaintext = Buffer.concat([
    decipher.update(decode(envelope.ciphertext)),
    decipher.final(),
  ]).toString('utf8');
  const payload = JSON.parse(plaintext) as Partial<BackupPayload>;
  if (!payload || !Array.isArray(payload.accounts)) throw new Error('The backup data is invalid.');
  return payload as BackupPayload;
}

function secureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
}

export async function exportAccountBackup(
  password: string,
  includeCredentials: boolean,
): Promise<AccountBackupResult> {
  if (password.length < 8) return { ok: false, message: 'Use a backup password with at least 8 characters.' };
  if (includeCredentials && (!secureStorageAvailable() || !(await safeStorage.isAsyncEncryptionAvailable()))) {
    return { ok: false, message: 'Secure credential storage is unavailable.' };
  }
  const accounts = await readAccounts();
  const portable: PortableAccount[] = [];
  for (const account of accounts) {
    const { encryptedSecret, ...settings } = account;
    const secret = includeCredentials
      ? (await safeStorage.decryptStringAsync(Buffer.from(encryptedSecret, 'base64'))).result
      : undefined;
    portable.push({
      ...settings,
      ...(secret !== undefined ? { secret } : {}),
    });
  }
  const result = await dialog.showSaveDialog({
    title: 'Export account backup',
    defaultPath: `Emzero Accounts ${new Date().toISOString().slice(0, 10)}.emzero-backup`,
    filters: [{ name: 'Emzero encrypted backup', extensions: ['emzero-backup'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true, message: 'Export canceled.' };
  await writeFile(result.filePath, await encryptBackup({ exportedAt: new Date().toISOString(), accounts: portable }, password), { mode: 0o600 });
  return { ok: true, message: `Exported ${accounts.length} account${accounts.length === 1 ? '' : 's'}.` };
}

export async function selectAccountBackup() {
  const result = await dialog.showOpenDialog({
    title: 'Choose account backup',
    properties: ['openFile'],
    filters: [{ name: 'Emzero encrypted backup', extensions: ['emzero-backup'] }],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, canceled: true, message: 'Import canceled.' };
  }
  const selectionId = randomUUID();
  selectedBackups.set(selectionId, result.filePaths[0]);
  return {
    ok: true,
    message: 'Backup selected.',
    selectionId,
    fileName: path.basename(result.filePaths[0]),
  };
}

export async function importAccountBackup(selectionId: string, password: string): Promise<AccountBackupResult> {
  if (!password) return { ok: false, message: 'Enter the backup password.' };
  const filePath = selectedBackups.get(selectionId);
  if (!filePath) return { ok: false, message: 'Choose the backup file again.' };
  if (!secureStorageAvailable() || !(await safeStorage.isAsyncEncryptionAvailable())) {
    return { ok: false, message: 'Secure credential storage is unavailable.' };
  }
  let payload: BackupPayload;
  try {
    payload = await decryptBackup(await readFile(filePath, 'utf8'), password);
  } catch {
    return { ok: false, message: 'The backup password is incorrect, or the backup is damaged.' };
  }
  selectedBackups.delete(selectionId);
  const existing = await readAccounts();
  const emails = new Set(existing.map((account) => account.email.toLowerCase()));
  const imported: StoredAccount[] = [];
  let missingCredentials = 0;
  for (const account of payload.accounts) {
    if (!account || typeof account.email !== 'string' || emails.has(account.email.toLowerCase())) continue;
    if (typeof account.secret !== 'string' || !account.secret) {
      missingCredentials += 1;
      continue;
    }
    const { secret, ...settings } = account;
    imported.push({
      ...settings,
      encryptedSecret: (await safeStorage.encryptStringAsync(secret)).toString('base64'),
    });
    emails.add(account.email.toLowerCase());
  }
  const next = [...existing, ...imported];
  if (imported.length) await writeAccounts(next);
  const suffix = missingCredentials
    ? ` ${missingCredentials} account${missingCredentials === 1 ? '' : 's'} had no credentials and could not be restored.`
    : '';
  return {
    ok: true,
    message: `Imported ${imported.length} account${imported.length === 1 ? '' : 's'}.${suffix}`,
    accounts: next.map(toAccountSummary),
  };
}
