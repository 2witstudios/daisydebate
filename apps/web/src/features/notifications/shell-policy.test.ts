import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  arrivalKey,
  arrivalsOf,
  badgeText,
  shownOn,
  titleWith,
  toastWaits,
} from './shell-policy';

setupRitewayBun();

const row = (
  id: string,
  kind: Parameters<typeof toastWaits>[0],
  href: string,
) => ({ id, kind, href, text: id, surfacedAt: '2026-11-16T12:00:00.000Z' });

describe('badges and title', () => {
  test('counts', () => {
    assert({
      given: 'none, three and twelve unread',
      should: 'show nothing, the count, then 9+',
      actual: [badgeText(0), badgeText(3), badgeText(12)],
      expected: [null, '3', '9+'],
    });
  });

  test('the title carries the count once', () => {
    assert({
      given: 'a title, the same title already counted, and none left',
      should: 'put the count first once, and take it off at zero',
      actual: [
        titleWith('Lobby · Daisy', 3),
        titleWith('(3) Lobby · Daisy', 12),
        titleWith('(9+) Lobby · Daisy', 0),
      ],
      expected: ['(3) Lobby · Daisy', '(9+) Lobby · Daisy', 'Lobby · Daisy'],
    });
  });
});

describe('toastWaits', () => {
  test('what asks for an answer waits', () => {
    assert({
      given: 'a challenge, a friend request, an acceptance and a recording',
      should: 'keep the first two until dismissed and let the rest go',
      actual: [
        toastWaits('challenge_received'),
        toastWaits('friend_request_received'),
        toastWaits('friend_request_accepted'),
        toastWaits('recording_ready'),
      ],
      expected: [true, true, false, false],
    });
  });
});

describe('arrivalsOf', () => {
  const recent = [
    row('c', 'challenge_received', '/friends'),
    row('i', 'room_invitation', '/rooms/r1'),
    row('a', 'friend_request_accepted', '/friends'),
  ];

  test('the first read interrupts no one', () => {
    assert({
      given: 'the tab’s first read',
      should: 'present nothing that was already waiting',
      actual: arrivalsOf({ seen: null, recent, path: '/lobby' }),
      expected: { toasts: [], urgent: [] },
    });
  });

  test('new rows, minus what this page shows', () => {
    const { toasts, urgent } = arrivalsOf({
      seen: new Set([arrivalKey(recent[2]!)]),
      recent,
      path: '/rooms/r1',
    });
    assert({
      given:
        'a challenge and an invitation since the last read, on the invited Room',
      should:
        'toast nothing (the invited Room shows its invitation, and a challenge has its own cards), but sound the challenge: it needs the member now',
      actual: {
        toasts: toasts.map((t) => t.id),
        urgent: urgent.map((t) => t.id),
      },
      expected: { toasts: [], urgent: ['c'] },
    });
  });

  test('a resurfaced row is news again', () => {
    const decision = row('d', 'round_decision_released', '/rounds/r1');
    const later = { ...decision, surfacedAt: '2026-11-16T13:00:00.000Z' };
    assert({
      given: 'a decision already presented, then brought back by its analysis',
      should: 'present it once more, under the same id',
      actual: [
        arrivalsOf({
          seen: new Set([arrivalKey(decision)]),
          recent: [decision],
          path: '/lobby',
        }).toasts.length,
        arrivalsOf({
          seen: new Set([arrivalKey(decision)]),
          recent: [later],
          path: '/lobby',
        }).toasts.length,
      ],
      expected: [0, 1],
    });
  });

  test('shownOn', () => {
    assert({
      given: 'the Friends page, with a query',
      should: 'name the unread rows that page shows',
      actual: shownOn(recent, '/friends'),
      expected: ['c', 'a'],
    });
  });
});
