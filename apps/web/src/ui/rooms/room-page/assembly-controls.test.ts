import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { declaredSeats, readinessControl } from './assembly-controls';

setupRitewayBun();

const participant = (role: 'affirmative' | 'judge') => ({
  id: 'participant',
  actorId: 'actor',
  label: 'Member',
  consentVersion: 0,
  kind: 'human' as const,
  role,
  slot: 0,
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
  capabilities: { canReady: true },
});

describe('canonical room assembly controls', () => {
  test('declared team seats do not assume symmetric sides or one judge', () => {
    assert({
      given: 'two affirmative seats, three negative seats and two judges',
      should: 'render every declared slot in role order',
      actual: declaredSeats({ affirmative: 2, negative: 3, judge: 2 }),
      expected: [
        { role: 'affirmative', slot: 0 },
        { role: 'affirmative', slot: 1 },
        { role: 'negative', slot: 0 },
        { role: 'negative', slot: 1 },
        { role: 'negative', slot: 2 },
        { role: 'judge', slot: 0 },
        { role: 'judge', slot: 1 },
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
      expected: { type: 'ready', enabled: true, reason: null },
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
      },
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
      { affirmative: 1_000_000_000, negative: 1, judge: 0 },
      { affirmative: 1, negative: 1, judge: 1_000_000_000 },
      { affirmative: 1, negative: 1_000_000_000, judge: 0 },
      { affirmative: 128, negative: 128, judge: 1 },
      { affirmative: 1, negative: 0, judge: 0 },
      { affirmative: -1, negative: 1, judge: 0 },
      { affirmative: 1.5, negative: 1, judge: 0 },
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
  const seats = declaredSeats({ affirmative: 255, negative: 1, judge: 0 });
  assert({
    given: 'unequal sides at exactly 256 total seats',
    should: 'expand all declared seats without truncation',
    actual: [seats.length, seats[254], seats[255]],
    expected: [
      256,
      { role: 'affirmative', slot: 254 },
      { role: 'negative', slot: 0 },
    ],
  });
});
