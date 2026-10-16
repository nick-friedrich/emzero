import { describe, expect, it } from 'vitest';
import { dateBucket } from './conversation-row';
import { countByInboxGroup, sortByInboxGroup, type InboxGroup } from './inbox-view-options';

describe('dateBucket', () => {
  const now = new Date(2026, 9, 16, 15, 0);

  it('buckets by local calendar day', () => {
    expect(dateBucket(new Date(2026, 9, 16, 0, 5).toISOString(), now)).toBe('today');
    expect(dateBucket(new Date(2026, 9, 15, 23, 59).toISOString(), now)).toBe('yesterday');
    expect(dateBucket(new Date(2026, 9, 10).toISOString(), now)).toBe('week');
    expect(dateBucket(new Date(2026, 8, 20).toISOString(), now)).toBe('month');
    expect(dateBucket(new Date(2025, 0, 1).toISOString(), now)).toBe('older');
  });

  it('treats missing or invalid dates as older', () => {
    expect(dateBucket(null, now)).toBe('older');
    expect(dateBucket('not a date', now)).toBe('older');
  });
});

describe('inbox group ordering', () => {
  const items: { id: string; group: InboxGroup }[] = [
    { id: 'a', group: 'other' },
    { id: 'b', group: 'unread' },
    { id: 'c', group: 'starred' },
    { id: 'd', group: 'unread' },
    { id: 'e', group: 'other' },
  ];

  it('stable-sorts starred, then unread, then other mail', () => {
    expect(sortByInboxGroup(items, (item) => item.group).map((item) => item.id))
      .toEqual(['c', 'b', 'd', 'a', 'e']);
  });

  it('counts each group', () => {
    expect([...countByInboxGroup(items, (item) => item.group)])
      .toEqual([['other', 2], ['unread', 2], ['starred', 1]]);
  });
});
