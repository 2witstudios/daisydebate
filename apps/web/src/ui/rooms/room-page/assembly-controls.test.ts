import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { twoSides, type SeatRef } from '@daisy/protocol';
import { declaredSeats, readinessControl } from './assembly-controls';

setupRitewayBun();

const seating = (affirmative: number, negative: number, judges: number) => ({
  sides: twoSides,
  seats: {
    sides: { affirmative, negative },
    speakers: 0,
    judges,
    moderators: 0,
  },
});
const seatOf = (role: 'affirmative' | 'judge'): SeatRef =>
  role === 'judge'
    ? { kind: 'judge', slot: 0 }
    : { kind: 'side', side: role, slot: 0 };

const participant = (role: 'affirmative' | 'judge') => ({
  id: 'participant',
  actorId: 'actor',
  label: 'Member',
  consentVersion: 0,
  kind: 'human' as const,
  seat: seatOf(role),
  teamOpen: false,
  positionOpen: false,
  rating: null,
  ageBand: null,
  needsReady: true,
  ready: 'not-ready' as const,
  eligible: true,
});
const view = (
  role: 'affirmative' | 'judge',
  ready: 'ready' | 'not-ready' = 'not-ready',
) => ({
  participants: [{ ...participant(role), ready }],
  readiness: { available: true, version: 4, readyActorIds: [] },
  version: 4,
  contentWaiver: null,
  contentWaiverVersion: null,
  capabilities: { canReady: true },
});

describe('canonical room assembly controls', () => {
  test('an unsigned content waiver holds Ready', () => {
    assert({
      given: 'a seated debater who has not signed the season waiver',
      should: 'offer Ready disabled, saying why',
      actual: readinessControl(
        { ...view('affirmative'), contentWaiver: 'unsigned' as const },
        'actor',
        { devicesPassed: true, unreadyPending: false },
      ),
      expected: {
        type: 'ready',
        enabled: false,
        reason: 'Sign the ranked content waiver before readying.',
        blocker: 'waiver',
      },
    });
  });

  test('declared team seats do not assume symmetric sides or one judge', () => {
    assert({
      given: 'two affirmative seats, three negative seats and two judges',
      should: 'render every declared slot in role order',
      actual: declaredSeats(seating(2, 3, 2)),
      expected: [
        { kind: 'side', side: 'affirmative', slot: 0 },
        { kind: 'side', side: 'affirmative', slot: 1 },
        { kind: 'side', side: 'negative', slot: 0 },
        { kind: 'side', side: 'negative', slot: 1 },
        { kind: 'side', side: 'negative', slot: 2 },
        { kind: 'judge', slot: 0 },
        { kind: 'judge', slot: 1 },
      ],
    });
  });

  test('judge ready does not depend on local device JavaScript', () => {
    assert({
      given: 'an eligible seated judge and no local checks',
      should: 'permit native Ready',
      actual: readinessControl(view('judge'), 'actor', {
        devicesPassed: false,
        unreadyPending: false,
      }),
      expected: { type: 'ready', enabled: true, reason: null, blocker: null },
    });
  });

  test('debater ready requires current device checks', () => {
    assert({
      given: 'an eligible debater with unchecked devices',
      should: 'block Ready with an actionable reason',
      actual: readinessControl(view('affirmative'), 'actor', {
        devicesPassed: false,
        unreadyPending: false,
      }),
      expected: {
        type: 'ready',
        enabled: false,
        reason: 'Check your camera and microphone before readying.',
        blocker: 'devices',
      },
    });
  });

  test('an earlier refusal outranks unchecked devices', () => {
    const source = view('affirmative');
    assert({
      given: 'a debater with unchecked devices and stale readiness',
      should: 'name the stale readiness, not the devices',
      actual: readinessControl(
        { ...source, readiness: { ...source.readiness, version: 3 } },
        'actor',
        { devicesPassed: false, unreadyPending: false },
      )?.blocker,
      expected: 'unavailable',
    });
  });

  test('pending unready cannot become acknowledged server readiness', () => {
    assert({
      given: 'a still-ready server view and an unacknowledged local unready',
      should: 'offer retry rather than Ready or claim acknowledgement',
      actual: readinessControl(view('affirmative', 'ready'), 'actor', {
        devicesPassed: true,
        unreadyPending: true,
      }),
      expected: {
        type: 'unready',
        enabled: true,
        reason: 'Not ready requested. Waiting for server confirmation.',
        blocker: null,
      },
    });
  });

  test('stale readiness and unavailable service prevent ready', () => {
    const source = view('judge');
    assert({
      given: 'readiness from an older room version',
      should: 'require an authoritative reread',
      actual: readinessControl(
        { ...source, readiness: { ...source.readiness, version: 3 } },
        'actor',
        { devicesPassed: true, unreadyPending: false },
      ),
      expected: {
        type: 'ready',
        enabled: false,
        reason: 'Readiness is unavailable. Refresh the room and try again.',
        blocker: 'unavailable',
      },
    });
  });

  test('bots and spectators do not get a human Ready control', () => {
    const source = view('judge');
    assert({
      given: 'a bot seat and an unseated viewer',
      should: 'leave eligibility and bot readiness to the server',
      actual: [
        readinessControl(
          {
            ...source,
            participants: [{ ...participant('judge'), kind: 'bot' }],
          },
          'actor',
          { devicesPassed: true, unreadyPending: false },
        ),
        readinessControl(source, 'spectator', {
          devicesPassed: true,
          unreadyPending: false,
        }),
      ],
      expected: [null, null],
    });
  });
});

test('unsafe seat expansion fails before allocation instead of truncating', () => {
  const original = Array.from;
  const outcomes: string[] = [];
  let allocations = 0;
  Array.from = (() => {
    allocations += 1;
    throw new Error('Unsafe expansion reached');
  }) as typeof Array.from;
  try {
    for (const seats of [
      seating(1_000_000_000, 1, 0),
      seating(1, 1, 1_000_000_000),
      seating(1, 1_000_000_000, 0),
      seating(128, 128, 1),
      seating(1, 0, 0),
      seating(-1, 1, 0),
      seating(1.5, 1, 0),
    ]) {
      try {
        declaredSeats(seats);
        outcomes.push('accepted');
      } catch (error) {
        outcomes.push(error instanceof Error ? error.message : 'unknown');
      }
    }
  } finally {
    Array.from = original;
  }
  assert({
    given: 'malformed counts passed directly into the UI consumer',
    should:
      'refuse before any Array.from or downstream command identity allocation',
    actual: [outcomes, allocations],
    expected: [outcomes.map(() => 'Invalid room seats'), 0],
  });
});

test('seat expansion includes the complete resource boundary', () => {
  const seats = declaredSeats(seating(255, 1, 0));
  assert({
    given: 'unequal sides at exactly 256 total seats',
    should: 'expand all declared seats without truncation',
    actual: [seats.length, seats[254], seats[255]],
    expected: [
      256,
      { kind: 'side', side: 'affirmative', slot: 254 },
      { kind: 'side', side: 'negative', slot: 0 },
    ],
  });
});
