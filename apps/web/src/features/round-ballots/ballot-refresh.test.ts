import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead, RoundWaitingOn } from '@daisy/protocol';
import {
  ballotKeepsRefreshing,
  ballotRefreshEveryMs,
  ballotRefreshGraceMs,
} from './ballot-refresh';

setupRitewayBun();

const deadline = Date.parse('2026-10-22T00:30:00.000Z');
const deadlineAt = new Date(deadline).toISOString();
const freeze: NonNullable<RoundBallotRead['freeze']> = {
  revision: 1,
  frontier: 0,
  frozenAt: '2026-10-22T00:00:00.000Z',
  completeness: 'complete',
  utterances: [],
};
const ballot = (
  status: RoundBallotRead['round']['status'],
  frozen: boolean,
  waitingOn: RoundWaitingOn | null,
) => ({ round: { status, waitingOn }, freeze: frozen ? freeze : null });
const humanWindow: RoundWaitingOn = { state: 'human_window', deadlineAt };

const cases: readonly {
  readonly given: string;
  readonly view: ReturnType<typeof ballot>;
  readonly unacknowledged?: boolean;
  readonly nowMs: number;
  readonly expected: boolean;
}[] = [
  {
    given: 'an active Round whose transcript is not frozen yet',
    view: ballot('active', false, { state: 'closing_transcript' }),
    nowMs: deadline - 60_000,
    expected: true,
  },
  {
    given: 'a frozen Round a minute before the judging window closes',
    view: ballot('active', true, humanWindow),
    nowMs: deadline - 60_000,
    expected: true,
  },
  {
    given: 'a frozen Round at the instant the judging window closes',
    view: ballot('active', true, humanWindow),
    nowMs: deadline,
    expected: true,
  },
  {
    given: 'a frozen Round one refresh after the judging window closed',
    view: ballot('active', true, humanWindow),
    nowMs: deadline + ballotRefreshEveryMs,
    expected: true,
  },
  {
    given: 'a frozen Round whose closed window the server never moved past',
    view: ballot('active', true, humanWindow),
    nowMs: deadline + ballotRefreshGraceMs,
    expected: false,
  },
  {
    given: 'a frozen Round before the AI judge’s deadline',
    view: ballot('active', true, { state: 'ai_processing', deadlineAt }),
    nowMs: deadline - 1,
    expected: true,
  },
  {
    given: 'a frozen Round before the attendance cutoff',
    view: ballot('active', true, {
      state: 'awaiting_attendance',
      deadlineAt,
    }),
    nowMs: deadline - 1,
    expected: true,
  },
  {
    given: 'a frozen Round settling with no deadline, long after the window',
    view: ballot('active', true, { state: 'settling' }),
    nowMs: deadline + 3_600_000,
    expected: true,
  },
  {
    given: 'a frozen Round that says nothing about what it waits on',
    view: ballot('active', true, null),
    nowMs: deadline + 3_600_000,
    expected: true,
  },
  {
    given: 'an unacknowledged ballot holding a frozen Round’s page',
    view: ballot('active', true, humanWindow),
    unacknowledged: true,
    nowMs: deadline - 60_000,
    expected: false,
  },
  {
    given: 'an unacknowledged ballot holding an unfrozen Round’s page',
    view: ballot('active', false, null),
    unacknowledged: true,
    nowMs: deadline - 60_000,
    expected: false,
  },
  {
    given: 'a completed Round, before the deadline it once carried',
    view: ballot('completed', true, humanWindow),
    nowMs: deadline - 60_000,
    expected: false,
  },
  {
    given: 'a completed Round that never froze',
    view: ballot('completed', false, null),
    nowMs: deadline - 60_000,
    expected: false,
  },
  {
    given: 'a Round still opening',
    view: ballot('opening', false, null),
    nowMs: deadline - 60_000,
    expected: false,
  },
];

for (const { given, view, unacknowledged = false, nowMs, expected } of cases)
  test(`ballot refresh: ${given}`, () => {
    assert({
      given,
      should: expected ? 'keep refreshing the Round' : 'not refresh the Round',
      actual: ballotKeepsRefreshing(view, unacknowledged, nowMs),
      expected,
    });
  });

test('the grace after a deadline outlasts a refresh', () => {
  assert({
    given: 'the refresh interval and the grace after a deadline',
    should:
      'leave room for a refresh after the deadline, so the page never stops one refresh short of the server',
    actual: ballotRefreshGraceMs > ballotRefreshEveryMs,
    expected: true,
  });
});
