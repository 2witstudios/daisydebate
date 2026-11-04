import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  earlierUnreadSequence,
  messageRows,
  messageTime,
} from './message-rows';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const live = (
  sequence: number,
  author: string,
  createdAt: string,
) => ({
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
  test('an earlier first unread', () => {
    const window = [
      live(60, them, now),
      live(11, them, now),
    ];
    assert({
      given: 'a first unread older than the window, inside it and absent',
      should: 'offer the jump only when it is older',
      actual: [
        earlierUnreadSequence(window, 5),
        earlierUnreadSequence(window, 11),
        earlierUnreadSequence(window, null),
        earlierUnreadSequence([], 5),
      ],
      expected: [5, null, null, null],
    });
  });
});
