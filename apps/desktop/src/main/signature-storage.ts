import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  toStoredSignature,
  validMailSignatures,
  type MailSignature,
  type SignatureListResult,
} from '../shared/signatures.js';

const signaturesPath = () => path.join(app.getPath('userData'), 'signatures.json');

export async function readSignatures(): Promise<SignatureListResult> {
  let contents: string;
  try {
    contents = await readFile(signaturesPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { signatures: [], initialized: false };
    }
    throw error;
  }
  try {
    const value: unknown = JSON.parse(contents);
    if (!validMailSignatures(value)) return { signatures: [], initialized: true };
    return { signatures: value.map(toStoredSignature), initialized: true };
  } catch {
    // A damaged file still counts as written: migrating over it would replace the user's current
    // signatures with whatever a stale browser-storage copy happens to hold.
    return { signatures: [], initialized: true };
  }
}

export async function writeSignatures(signatures: MailSignature[]): Promise<void> {
  const target = signaturesPath();
  const temporary = `${target}.${process.pid}.tmp`;
  const stored = signatures.map(toStoredSignature);
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}
