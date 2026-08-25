import { describe, expect, it } from 'vitest';
import { childFolderPath, validFolderName } from './account-folders.js';

describe('folder input helpers', () => {
  it('builds root and nested folder paths with the provider delimiter', () => {
    expect(childFolderPath('', 'Receipts', '/')).toBe('Receipts');
    expect(childFolderPath('Projects', 'Emzero', '/')).toBe('Projects/Emzero');
    expect(childFolderPath('Projects', 'Emzero', '.')).toBe('Projects.Emzero');
  });

  it('rejects empty, nested, unsafe, and excessively long folder names', () => {
    expect(validFolderName(' Receipts ', '/')).toBe(true);
    expect(validFolderName('Projects/Emzero', '/')).toBe(false);
    expect(validFolderName('line\nbreak', '/')).toBe(false);
    expect(validFolderName('\0', '/')).toBe(false);
    expect(validFolderName('x'.repeat(201), '/')).toBe(false);
  });
});
