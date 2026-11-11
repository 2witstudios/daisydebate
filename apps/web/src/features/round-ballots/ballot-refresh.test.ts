import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead, RoundWaitingOn } from '@daisy/protocol';
import {
  ballotRefreshCeilingMs,
  ballotRefreshEveryMs,
  ballotRefreshGraceMs,
  ballotRefreshInMs,
  ballotWaitSince,
} from './ballot-refresh';

setupRitewayBun();

const deadline = Date.parse('2026-10-22T00:30:00.000Z');
const deadlineAt = new Date(deadline).toISOString();
const ballot = (
  status: RoundBallotRead['round']['status'],
  waitingOn: RoundWaitingOn | null,
) => ({ round: { status, waitingOn } });
const humanWindow: RoundWaitingOn = { state: 'human_window', deadlineAt };
const minute = 60_000;

const cases: readonly {
  readonly given: string;
  readonly view: ReturnType<typeof ballot>;
  readonly held?: boolean;
  /** How long past the deadline the present is. */
  readonly pastDeadlineMs: number;
  /** How long the page has seen the Round wait on this. */
  readonly waitedMs?: number;
  readonly expected: number | null;
}[] = [
  {
    given: 'an active Round whose speeches are still running, an hour in',
    view: ballot('active', null),
    pastDeadlineMs: -minute,
    waitedMs: 60 * minute,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round a minute before the judging window closes',
    view: ballot('active', humanWindow),
    pastDeadlineMs: -minute,
    waitedMs: 30 * minute,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round at the instant the judging window closes',
    view: ballot('active', humanWindow),
    pastDeadlineMs: 0,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round one refresh after the judging window closed',
    view: ballot('active', humanWindow),
    pastDeadlineMs: ballotRefreshEveryMs,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round whose closed window the server never moved past',
    view: ballot('active', humanWindow),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: null,
  },
  {
    given: 'a Round just before the AI judge’s deadline',
    view: ballot('active', { state: 'ai_processing', deadlineAt }),
    pastDeadlineMs: -1,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round whose AI judge’s deadline the server never moved past',
    view: ballot('active', { state: 'ai_processing', deadlineAt }),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: null,
  },
  {
    given: 'a Round just before the attendance cutoff',
    view: ballot('active', { state: 'awaiting_attendance', deadlineAt }),
    pastDeadlineMs: -1,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round whose attendance cutoff the server never moved past',
    view: ballot('active', { state: 'awaiting_attendance', deadlineAt }),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: null,
  },
  {
    given: 'a Round the page has just seen begin settling',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 0,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round the page has seen settling for half a minute',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 30_000,
    expected: ballotRefreshEveryMs,
  },
  {
    given: 'a Round the page has seen settling for two minutes',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: 20_000,
  },
  {
    given: 'a Round the page has seen settling for an hour',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 60 * minute,
    expected: ballotRefreshCeilingMs,
  },
  {
    given: 'a Round whose transcript has been closing for two minutes',
    view: ballot('active', { state: 'closing_transcript' }),
    pastDeadlineMs: -minute,
    waitedMs: 2 * minute,
    expected: 20_000,
  },
  {
    given: 'a Round held by a writer for two minutes',
    view: ballot('active', { state: 'held_by_writer' }),
    pastDeadlineMs: -minute,
    waitedMs: 2 * minute,
    expected: 20_000,
  },
  {
    given: 'a Round whose AI judge has been recovering for two minutes',
    view: ballot('active', { state: 'ai_recovering' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: 20_000,
  },
  {
    given: 'a Round whose AI judge failed two minutes ago and is yet to settle',
    view: ballot('active', { state: 'ai_failed' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: 20_000,
  },
  {
    given: 'a Round whose AI judge is blocked, the moment the page sees it',
    view: ballot('active', { state: 'ai_blocked' }),
    pastDeadlineMs: -minute,
    waitedMs: 0,
    expected: null,
  },
  {
    given: 'an unacknowledged ballot holding a Round’s page inside its window',
    view: ballot('active', humanWindow),
    held: true,
    pastDeadlineMs: -minute,
    expected: null,
  },
  {
    given: 'an unacknowledged ballot holding a Round whose speeches still run',
    view: ballot('active', null),
    held: true,
    pastDeadlineMs: -minute,
    expected: null,
  },
  {
    given: 'a completed Round, before the deadline it once carried',
    view: ballot('completed', humanWindow),
    pastDeadlineMs: -minute,
    expected: null,
  },
  {
    given: 'a completed Round that waits on nothing',
    view: ballot('completed', null),
    pastDeadlineMs: -minute,
    expected: null,
  },
  {
    given: 'a Round still opening',
    view: ballot('opening', null),
    pastDeadlineMs: -minute,
    expected: null,
  },
];

for (const {
  given,
  view,
  held = false,
  pastDeadlineMs,
  waitedMs = 0,
  expected,
} of cases)
  test(`ballot refresh: ${given}`, () => {
    const nowMs = deadline + pastDeadlineMs;
    assert({
      given,
      should:
        expected === null
          ? 'not refresh the Round'
          : `refresh the Round in ${expected / 1000} s`,
      actual: ballotRefreshInMs(view, held, {
        nowMs,
        waitingSinceMs: nowMs - waitedMs,
      }),
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

test('a wait is dated from the render that first showed it', () => {
  const first = ballotWaitSince(null, { state: 'settling' }, 1_000);
  const same = ballotWaitSince(first, { state: 'settling' }, 6_000);
  const next = ballotWaitSince(same, { state: 'ai_failed' }, 11_000);
  const speeches = ballotWaitSince(next, null, 16_000);
  assert({
    given:
      'a Round first seen settling, refreshed with nothing new, then seen waiting on something else, then on nothing',
    should:
      'keep the first render’s instant while the wait is the same and start over when it changes',
    actual: [first, same, next, speeches],
    expected: [
      { state: 'settling', sinceMs: 1_000 },
      { state: 'settling', sinceMs: 1_000 },
      { state: 'ai_failed', sinceMs: 11_000 },
      { state: null, sinceMs: 16_000 },
    ],
  });
});
