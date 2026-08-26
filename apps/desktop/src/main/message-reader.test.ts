import { describe, expect, it } from 'vitest';
import type { MessageStructureObject } from 'imapflow';
import {
  mailDateString,
  messageAttachmentSummaries,
  messageTextParts,
  referenceIds,
  shouldFullyReconcileFolder,
} from './message-reader.js';

const multipartMessage: MessageStructureObject = {
  type: 'multipart/mixed',
  childNodes: [
    {
      type: 'multipart/alternative',
      childNodes: [
        { part: '1.1', type: 'text/plain', parameters: { charset: 'utf-8' }, size: 120 },
        { part: '1.2', type: 'text/html', parameters: { charset: 'utf-8' }, size: 240 },
      ],
    },
    {
      part: '2',
      type: 'application/pdf',
      disposition: 'attachment',
      dispositionParameters: { filename: 'report.pdf' },
      size: 5_000_000,
    },
    {
      type: 'multipart/related',
      childNodes: [
        { part: '3.1', type: 'text/html', size: 80 },
        {
          part: '3.2',
          type: 'image/png',
          id: '<logo>',
          parameters: { name: 'logo.png' },
          size: 4_000,
        },
      ],
    },
    {
      part: '4',
      type: 'message/rfc822',
      disposition: 'attachment',
      dispositionParameters: { filename: 'forwarded.eml' },
      size: 900,
      childNodes: [{ part: '4', type: 'text/plain', size: 300 }],
    },
  ],
};

describe('message reader helpers', () => {
  it('normalizes valid dates and rejects invalid dates', () => {
    expect(mailDateString('2026-08-25T08:30:00Z')).toBe('2026-08-25T08:30:00.000Z');
    expect(mailDateString('not-a-date')).toBeNull();
    expect(mailDateString(undefined)).toBeNull();
  });

  it('extracts message IDs from header and whitespace formats', () => {
    expect(referenceIds('<first@example.com> <second@example.com>')).toEqual([
      '<first@example.com>',
      '<second@example.com>',
    ]);
    expect(referenceIds(['first', 'second'])).toEqual(['first', 'second']);
  });
});

describe('lightweight message body selection', () => {
  it('downloads readable body parts without attachment payloads', () => {
    expect(messageTextParts(multipartMessage)).toEqual([
      { part: '1.1', type: 'text/plain', charset: 'utf-8' },
      { part: '1.2', type: 'text/html', charset: 'utf-8' },
      { part: '3.1', type: 'text/html', charset: undefined },
    ]);
  });

  it('uses IMAP part 1 for a single-part body whose structure has no part number', () => {
    expect(
      messageTextParts({ type: 'text/plain', parameters: { charset: 'iso-8859-1' }, size: 20 }),
    ).toEqual([{ part: '1', type: 'text/plain', charset: 'iso-8859-1' }]);
  });

  it('preserves regular and related attachment metadata from BODYSTRUCTURE', () => {
    expect(messageAttachmentSummaries(multipartMessage)).toEqual([
      {
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 5_000_000,
        related: false,
      },
      {
        filename: 'logo.png',
        contentType: 'image/png',
        size: 4_000,
        related: true,
      },
      {
        filename: 'forwarded.eml',
        contentType: 'message/rfc822',
        size: 900,
        related: false,
      },
    ]);
  });
});

describe('folder reconciliation scheduling', () => {
  it('uses incremental refreshes for recently reconciled folders', () => {
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    expect(shouldFullyReconcileFolder('2026-08-26T11:45:00.000Z', now)).toBe(false);
    expect(shouldFullyReconcileFolder('2026-08-26T11:20:00.000Z', now)).toBe(true);
    expect(shouldFullyReconcileFolder(null, now)).toBe(true);
  });
});
