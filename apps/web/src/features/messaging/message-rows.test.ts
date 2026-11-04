import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  knownFirstUnread,
  messageRows,
  messageTime,
  unreadPlacement,
} from './message-rows';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const live = (sequence: number, author: string, createdAt: string) => ({
  id: `m${String(sequence).padStart(23, '0')}`,
  channelId,
  authorActorId: author,
  sequence,
  changeVersion: sequence,
  text: `text ${sequence}`,
  createdAt,
  editedAt: null,
  reactions: [],
});
const gone = (sequence: number) => ({
  id: `m${String(sequence).padStart(23, '0')}`,
  channelId,
  sequence,
  changeVersion: sequence,
  unavailable: true as const,
});
const me = 'a'.repeat(24);
const them = 'b'.repeat(24);
const now = '2026-11-04T15:00:00.000Z';
const rows = (
  messages: Parameters<typeof messageRows>[0]['messages'],
  firstUnreadSequence: number | null = null,
  timeZone = 'UTC',
) =>
  messageRows({
    messages,
    actorId: me,
    otherAuthor: '@mara',
    firstUnreadSequence,
    now,
    timeZone,
  });
const shape = (drawn: ReturnType<typeof rows>) =>
  drawn.map((row) =>
    row.kind === 'message'
      ? `${row.leads ? 'lead' : 'run'}:${row.author}`
      : row.kind === 'day'
        ? `day:${row.label}`
        : row.kind,
  );

describe('message rows', () => {
  test('runs', () => {
    assert({
      given: 'newest-first history from two authors',
      should: 'draw oldest first, with a run per author inside five minutes',
      actual: shape(
        rows([
          live(4, me, '2026-11-04T14:20:00.000Z'),
          live(3, me, '2026-11-04T14:02:00.000Z'),
          live(2, them, '2026-11-04T14:01:00.000Z'),
          live(1, them, '2026-11-04T14:00:00.000Z'),
        ]),
      ),
      expected: [
        'day:Today',
        'lead:@mara',
        'run:@mara',
        'lead:You',
        'lead:You',
      ],
    });
  });
  test('days', () => {
    assert({
      given: 'messages across days',
      should: 'separate them and name today and yesterday',
      actual: shape(
        rows([
          live(3, them, '2026-11-04T01:00:00.000Z'),
          live(2, them, '2026-11-03T23:59:00.000Z'),
          live(1, them, '2026-10-28T12:00:00.000Z'),
        ]),
      ),
      expected: [
        'day:October 28, 2026',
        'lead:@mara',
        'day:Yesterday',
        'lead:@mara',
        'day:Today',
        'lead:@mara',
      ],
    });
  });
  test('time zones', () => {
    const late = [live(1, them, '2026-11-04T02:00:00.000Z')];
    assert({
      given: 'a reader whose zone is still on the day before',
      should: 'use their day and their time',
      actual: [
        shape(rows(late, null, 'America/Chicago'))[0],
        messageTime(late[0]!.createdAt, 'America/Chicago'),
        messageTime(late[0]!.createdAt, 'UTC'),
      ],
      expected: ['day:Yesterday', '8:00 PM', '2:00 AM UTC'],
    });
  });
  test('yesterday follows the local calendar through daylight saving changes', () => {
    assert({
      given: 'late on a 25-hour day in Chicago',
      should: 'name the previous calendar day Yesterday',
      actual: messageRows({
        messages: [live(1, them, '2026-10-31T16:00:00.000Z')],
        actorId: me,
        otherAuthor: '@mara',
        firstUnreadSequence: null,
        now: '2026-11-02T05:30:00.000Z',
        timeZone: 'America/Chicago',
      })[0],
      expected: { kind: 'day', key: 'day-2026-10-31', label: 'Yesterday' },
    });
  });
  test('a day and unread boundary at the same message', () => {
    assert({
      given: 'the first unread message starts a new day',
      should: 'place New immediately above that message after the day label',
      actual: shape(rows([live(1, them, now)], 1)),
      expected: ['day:Today', 'unread', 'lead:@mara'],
    });
  });
  test('the unread divider', () => {
    assert({
      given: 'a first unread inside a run',
      should: 'draw the divider above it and start a new run',
      actual: shape(
        rows(
          [
            live(2, them, '2026-11-04T14:01:00.000Z'),
            live(1, them, '2026-11-04T14:00:00.000Z'),
          ],
          2,
        ),
      ),
      expected: ['day:Today', 'lead:@mara', 'unread', 'lead:@mara'],
    });
    assert({
      given: 'no message at the first unread position',
      should: 'draw no divider',
      actual: shape(rows([live(5, them, '2026-11-04T14:00:00.000Z')], 2)),
      expected: ['day:Today', 'lead:@mara'],
    });
  });
  test('a removed message', () => {
    assert({
      given: 'a removed message inside a run',
      should: 'keep its place and end the run',
      actual: shape(
        rows([
          live(3, them, '2026-11-04T14:02:00.000Z'),
          gone(2),
          live(1, them, '2026-11-04T14:00:00.000Z'),
        ]),
      ),
      expected: ['day:Today', 'lead:@mara', 'unavailable', 'lead:@mara'],
    });
  });
  test('the divider from the position kept at opening', () => {
    const place = (
      firstUnreadSequence: number | null,
      messages: Parameters<typeof messageRows>[0]['messages'],
    ) =>
      unreadPlacement({ readSequence: 10, firstUnreadSequence }, messages, me);
    assert({
      given: 'nothing unread at opening, then only the reader writing',
      should: 'show no divider',
      actual: place(null, [live(11, me, now)]),
      expected: { dividerSequence: null, jumpToSequence: null },
    });
    assert({
      given: 'nothing unread at opening, then someone else writing',
      should: 'place it at their first message',
      actual: place(null, [
        live(13, them, now),
        live(12, them, now),
        live(11, me, now),
      ]),
      expected: { dividerSequence: 12, jumpToSequence: null },
    });
    assert({
      given: 'a first unread since removed',
      should: 'move to the next one eligible',
      actual: place(11, [live(12, them, now), gone(11)]),
      expected: { dividerSequence: 12, jumpToSequence: null },
    });
    assert({
      given: 'a first unread older than the window',
      should: 'offer the jump and no divider at a message that is not first',
      actual: place(5, [live(60, them, now), live(11, them, now)]),
      expected: { dividerSequence: null, jumpToSequence: 5 },
    });
  });
  test('a window that slides past a latched first unread', () => {
    const boundary = { readSequence: 10, firstUnreadSequence: null };
    const known = knownFirstUnread(boundary, [live(11, them, now)], me);
    assert({
      given: 'a first unread seen live, then a window past it',
      should: 'still know about it and offer the jump',
      actual: unreadPlacement(
        { ...boundary, firstUnreadSequence: known },
        [live(70, them, now), live(21, them, now)],
        me,
      ),
      expected: { dividerSequence: null, jumpToSequence: 11 },
    });
  });
});
