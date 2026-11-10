import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readNotificationItems } from './read-notifications';

setupRitewayBun();

describe('readNotificationItems', () => {
  test('the words come from the kind alone', async () => {
    const { items, unread } = await readNotificationItems(
      {
        readNotifications: async () => ({
          unread: 1,
          rows: [
            {
              id: 'a',
              kind: 'followed_debater_live',
              roundId: 'r1',
              debater: 'someone',
              readAt: null,
              createdAt: '2026-11-02T12:00:00.000Z',
            },
            {
              id: 'b',
              kind: 'recording_ready',
              roundId: 'r2',
              readAt: '2026-11-02T12:30:00.000Z',
              createdAt: '2026-11-02T10:00:00.000Z',
            },
            {
              id: 'c',
              kind: 'room_invitation',
              roomId: 'room1',
              seat: 'judge',
              host: 'coach',
              readAt: null,
              createdAt: '2026-11-02T12:59:00.000Z',
            },
            {
              id: 'd',
              kind: 'challenge_received',
              challenger: null,
              mode: 'casual',
              format: 'freestyle',
              readAt: null,
              createdAt: '2026-11-02T13:00:00.000Z',
            },
          ],
        }),
      } as never,
      { userId: 'u', unreadOnly: false, now: '2026-11-02T13:00:00.000Z' },
    );
    assert({
      given: 'one row of each kind, one about a member since erased',
      should: 'say what happened and where it leads, and nothing else',
      actual: { items, unread },
      expected: {
        unread: 1,
        items: [
          {
            id: 'a',
            text: '@someone is on air.',
            href: '/watch/r1',
            minutesAgo: 60,
            unread: true,
          },
          {
            id: 'b',
            text: 'A recording is ready to watch.',
            href: '/recordings/r2',
            minutesAgo: 180,
            unread: false,
          },
          {
            id: 'c',
            text: '@coach invited you to judge.',
            href: '/rooms/room1',
            minutesAgo: 1,
            unread: true,
          },
          {
            id: 'd',
            text: 'A member challenged you to a casual Freestyle debate.',
            href: '/friends',
            minutesAgo: 0,
            unread: true,
          },
        ],
      },
    });
  });
});
