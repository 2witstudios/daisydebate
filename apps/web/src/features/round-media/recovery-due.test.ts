import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  recoveryDue,
  recoveryNeed,
  type RecoverySession,
} from './recovery-due';
setupRitewayBun();

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const HEARTBEAT_MS = 2_000;
/** Mid-speech: passed a second ago, nothing committed since, the speech ends at 60 s. */
const idle = (over: Partial<RecoverySession> = {}): RecoverySession => ({
  roundId: 'idle',
  now: at(11),
  lastPassAt: at(10),
  roundChangedAt: at(5),
  roundStatus: 'active',
  unsafe: false,
  claimable: true,
  lastPassClean: true,
  clock: {
    startedAt: at(0),
    countdownMs: 1_000,
    segmentTotal: 4,
    prepBudgetMs: null,
    activePrep: null,
    segmentCount: 1,
    lastSegment: { startedAt: at(0), endedAt: null, durationMs: 60_000 },
  },
  ...over,
});
const clock = idle().clock;
const rounds = (due: readonly { readonly roundId: string }[]) =>
  due.map((session) => session.roundId);

test('a Round with nothing due costs no pass', () => {
  assert({
    given: 'a recent pass, no commit since and no boundary passed',
    should: 'need nothing',
    actual: recoveryNeed(idle(), HEARTBEAT_MS),
    expected: null,
  });
  assert({
    given: 'no pass for the whole heartbeat',
    should: 'need a heartbeat pass, for what the read cannot see',
    actual: recoveryNeed(idle({ now: at(12) }), HEARTBEAT_MS),
    expected: 'heartbeat',
  });
});

test('a floor that must move needs a pass at once', () => {
  assert({
    given: 'a commit since the last pass',
    should: 'need a floor pass',
    actual: recoveryNeed(idle({ roundChangedAt: at(11) }), HEARTBEAT_MS),
    expected: 'floor',
  });
  assert({
    given: 'an open speech whose end passed since the last pass',
    should: 'need a floor pass',
    actual: recoveryNeed(
      idle({
        lastPassAt: at(59),
        now: at(60),
      }),
      HEARTBEAT_MS,
    ),
    expected: 'floor',
  });
  assert({
    given: 'a yield whose countdown passed since the last pass',
    should: 'need a floor pass',
    actual: recoveryNeed(
      idle({
        roundChangedAt: at(8),
        lastPassAt: at(8),
        now: at(9),
        clock: {
          ...clock,
          lastSegment: {
            startedAt: at(0),
            endedAt: at(8),
            durationMs: 60_000,
          },
        },
      }),
      HEARTBEAT_MS,
    ),
    expected: 'floor',
  });
  assert({
    given: 'an expired speech with no commit, whose countdown then passes',
    should: 'need a floor pass for the next speaker',
    actual: recoveryNeed(
      idle({ lastPassAt: at(60), now: at(61) }),
      HEARTBEAT_MS,
    ),
    expected: 'floor',
  });
  assert({
    given: 'a boundary a pass has already covered',
    should: 'need nothing more for it',
    actual: recoveryNeed(
      idle({ lastPassAt: at(62), now: at(63) }),
      HEARTBEAT_MS,
    ),
    expected: null,
  });
});

test('a Round no claim can start for costs no pass yet', () => {
  assert({
    given: 'a floor that must move while a lease or the minimum interval holds',
    should: 'wait for a later tick instead of polling the lease',
    actual: recoveryNeed(
      idle({ roundChangedAt: at(11), claimable: false }),
      HEARTBEAT_MS,
    ),
    expected: null,
  });
});

test('what a session cannot wait out is a repair', () => {
  for (const [given, over] of [
    ['a session never passed', { lastPassAt: null }],
    ['an unsafe session', { unsafe: true }],
    ['a terminal Round', { roundStatus: 'completed' }],
  ] as const)
    assert({
      given,
      should: 'need a repair pass',
      actual: recoveryNeed(idle(over), HEARTBEAT_MS),
      expected: 'repair',
    });
});

test('a pass that did not finish leaves the Round due', () => {
  assert({
    given: 'a last pass that failed, no commit since, inside the heartbeat',
    should: 'need a repair pass on the next claimable tick',
    actual: recoveryNeed(idle({ lastPassClean: false }), HEARTBEAT_MS),
    expected: 'repair',
  });
});

test('an overdue heartbeat outranks floors and repairs for a slot', () => {
  const floor = (roundId: string) => idle({ roundId, roundChangedAt: at(11) });
  const overdue = idle({
    roundId: 'overdue',
    lastPassAt: at(5),
    roundChangedAt: at(0),
    now: at(11),
  });
  const fresh = idle({
    roundId: 'fresh',
    lastPassAt: at(8),
    roundChangedAt: at(0),
  });
  const repair = (roundId: string) => idle({ roundId, unsafe: true });
  assert({
    given: 'a Round past the overdue limit with no other need',
    should: 'read as overdue, not as a heartbeat',
    actual: [
      recoveryNeed(overdue, HEARTBEAT_MS),
      recoveryNeed(fresh, HEARTBEAT_MS),
    ],
    expected: ['overdue', 'heartbeat'],
  });
  assert({
    given: 'one overdue Round last in the list, and floors to fill every slot',
    should: 'give it a slot and let floors fill the rest',
    actual: rounds(
      recoveryDue(
        [floor('a'), floor('b'), floor('c'), floor('d'), overdue],
        new Set(),
        HEARTBEAT_MS,
      ),
    ),
    expected: ['overdue', 'a', 'b', 'c'],
  });
  assert({
    given: 'one overdue Round behind four stuck repairs',
    should: 'give it a slot ahead of them',
    actual: rounds(
      recoveryDue(
        [repair('a'), repair('b'), repair('c'), repair('d'), overdue],
        new Set(),
        HEARTBEAT_MS,
      ),
    ),
    expected: ['overdue', 'a', 'b', 'c'],
  });
  assert({
    given: 'a fresh heartbeat with floors to fill every slot',
    should: 'still come last, and wait',
    actual: rounds(
      recoveryDue(
        [fresh, floor('a'), floor('b'), floor('c'), floor('d')],
        new Set(),
        HEARTBEAT_MS,
      ),
    ),
    expected: ['a', 'b', 'c', 'd'],
  });
});

test('a tick spends its slots on floors first, then what is free', () => {
  const floor = idle({ roundId: 'floor', roundChangedAt: at(11) });
  const repair = idle({ roundId: 'repair', unsafe: true });
  const beat = idle({
    roundId: 'beat',
    lastPassAt: at(8),
    roundChangedAt: at(0),
  });
  const sessions = [beat, idle(), repair, floor];
  assert({
    given: 'a heartbeat first in the list, a repair, a floor and an idle Round',
    should:
      'start the floor, then the repair, then the heartbeat, not the idle',
    actual: rounds(recoveryDue(sessions, new Set(), HEARTBEAT_MS)),
    expected: ['floor', 'repair', 'beat'],
  });
  assert({
    given: 'one free slot',
    should: 'give it to the floor',
    actual: rounds(recoveryDue(sessions, new Set(), HEARTBEAT_MS, 1)),
    expected: ['floor'],
  });
  assert({
    given: 'the floor Round still recovering',
    should: 'skip only that Round, so it cannot hold the others',
    actual: rounds(recoveryDue(sessions, new Set(['floor']), HEARTBEAT_MS, 4)),
    expected: ['repair', 'beat'],
  });
  assert({
    given: 'capacity already used',
    should: 'start nothing',
    actual: rounds(recoveryDue(sessions, new Set(['x', 'y']), HEARTBEAT_MS, 2)),
    expected: [],
  });
});
