import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  appendPage,
  byAttention,
  mergeFirstPage,
  type MessagingInboxEntry,
} from './inbox-view';

setupRitewayBun();
const row = (channelId: string, minute: number): MessagingInboxEntry => ({
  channelId,
  kind: 'conversation',
  title: channelId,
  preview: null,
  activityAt: `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`,
  unread: false,
});
const invitation = (channelId: string): MessagingInboxEntry => ({
  channelId,
  kind: 'incoming_invitation',
});
const ids = (entries: readonly MessagingInboxEntry[]) =>
  entries.map((entry) => entry.channelId);

describe('inbox view', () => {
  test('attention order', () => {
    assert({
      given: 'invitations, older and newer activity, and a tie',
      should: 'lead with invitations, then newest, tied by channel',
      actual: ids(
        [row('old', 1), invitation('z'), row('b', 5), row('a', 5), invitation('y')].sort(
          byAttention,
        ),
      ),
      expected: ['y', 'z', 'a', 'b', 'old'],
    });
  });
  test('a fresh first page keeps what lies beyond it', () => {
    const loaded = {
      entries: [row('gone', 12), row('a', 9), row('b', 8), row('c', 7), row('d', 6)],
      nextAfter: 'cursor-2',
    };
    const merged = mergeFirstPage(loaded, {
      entries: [row('c', 10), row('a', 9)],
      nextAfter: 'cursor-1',
    });
    assert({
      given: 'a conversation that moved up and one that left the first page',
      should: 'reorder, drop what the page disproves, keep the rest and its continuation',
      actual: [ids(merged.entries), merged.nextAfter],
      expected: [['c', 'a', 'b', 'd'], 'cursor-2'],
    });
  });
  test('a final first page is the whole list', () => {
    assert({
      given: 'a first page with no continuation',
      should: 'replace everything loaded',
      actual: mergeFirstPage(
        { entries: [row('a', 9), row('b', 8)], nextAfter: 'cursor' },
        { entries: [row('a', 9)], nextAfter: null },
      ),
      expected: { entries: [row('a', 9)], nextAfter: null },
    });
  });
  test('an empty answer', () => {
    assert({
      given: 'an empty first page that still continues, all hidden rows',
      should: 'show nothing yet keep its continuation',
      actual: mergeFirstPage(
        { entries: [row('a', 9)], nextAfter: null },
        { entries: [], nextAfter: 'cursor' },
      ),
      expected: { entries: [], nextAfter: 'cursor' },
    });
  });
  test('a later page', () => {
    assert({
      given: 'a next page repeating a conversation that moved during paging',
      should: 'hold it once, in order',
      actual: appendPage(
        { entries: [row('a', 9), row('b', 8)], nextAfter: 'one' },
        { entries: [row('b', 8), row('c', 7)], nextAfter: null },
      ),
      expected: {
        entries: [row('a', 9), row('b', 8), row('c', 7)],
        nextAfter: null,
      },
    });
  });
});
