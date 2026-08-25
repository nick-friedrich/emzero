import { describe, expect, it } from 'vitest';
import {
  bulkJobProgress,
  cancelBulkMessageJob,
  validBulkMessageJobRequest,
} from './bulk-message-jobs.js';

describe('bulk message jobs', () => {
  it('validates action-specific destinations and request limits', () => {
    expect(
      validBulkMessageJobRequest({
        action: 'read',
        groups: [{ accountId: 'a', folderPath: 'INBOX', uids: [1, 2] }],
      }),
    ).toBe(true);
    expect(
      validBulkMessageJobRequest({
        action: 'move',
        groups: [{ accountId: 'a', folderPath: 'INBOX', uids: [1] }],
      }),
    ).toBe(false);
    expect(
      validBulkMessageJobRequest({
        action: 'delete',
        groups: [{ accountId: 'a', folderPath: 'INBOX', uids: Array.from({ length: 20_001 }, (_, index) => index + 1) }],
      }),
    ).toBe(false);
  });

  it('creates progress snapshots with optional update fields', () => {
    expect(
      bulkJobProgress(
        { id: 'job-1', action: 'archive', total: 10, processed: 4, cancelRequested: false },
        'running',
        { accountId: 'account-1', processedUids: [2, 3] },
      ),
    ).toEqual({
      jobId: 'job-1',
      action: 'archive',
      state: 'running',
      total: 10,
      processed: 4,
      accountId: 'account-1',
      processedUids: [2, 3],
    });
  });

  it('does not cancel a job that is no longer active', () => {
    expect(cancelBulkMessageJob('missing-job')).toBe(false);
  });
});
