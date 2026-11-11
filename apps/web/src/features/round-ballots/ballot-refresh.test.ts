import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead, RoundWaitingOn } from '@daisy/protocol';
import {
  ballotRefreshCeilingMs,
  ballotRefreshEveryMs,
  ballotRefreshGraceMs,
  ballotRefresh,
  type BallotRefresh,
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
const steadily: BallotRefresh = { kind: 'in', ms: ballotRefreshEveryMs };
const inMs = (ms: number): BallotRefresh => ({ kind: 'in', ms });
const once: BallotRefresh = { kind: 'once' };
const none: BallotRefresh = { kind: 'none' };

const cases: readonly {
  readonly given: string;
  readonly view: ReturnType<typeof ballot>;
  readonly held?: boolean;
  /** How long past the deadline the present is. */
  readonly pastDeadlineMs: number;
  /** How long the page has seen the Round wait on this. */
  readonly waitedMs?: number;
  /** How long before the present the server rendered what the page shows; none when it just did. */
  readonly renderedAgoMs?: number;
  readonly expected: BallotRefresh;
}[] = [
  {
    given: 'an active Round whose speeches are still running, an hour in',
    view: ballot('active', null),
    pastDeadlineMs: -minute,
    waitedMs: 60 * minute,
    expected: steadily,
  },
  {
    given: 'a Round a minute before the judging window closes',
    view: ballot('active', humanWindow),
    pastDeadlineMs: -minute,
    waitedMs: 30 * minute,
    expected: steadily,
  },
  {
    given: 'a Round at the instant the judging window closes',
    view: ballot('active', humanWindow),
    pastDeadlineMs: 0,
    expected: steadily,
  },
  {
    given: 'a Round one refresh after the judging window closed',
    view: ballot('active', humanWindow),
    pastDeadlineMs: ballotRefreshEveryMs,
    expected: steadily,
  },
  {
    given: 'a Round whose closed window the server never moved past',
    view: ballot('active', humanWindow),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: none,
  },
  {
    given: 'a Round just before the AI judge’s deadline',
    view: ballot('active', { state: 'ai_processing', deadlineAt }),
    pastDeadlineMs: -1,
    expected: steadily,
  },
  {
    given: 'a Round whose AI judge’s deadline the server never moved past',
    view: ballot('active', { state: 'ai_processing', deadlineAt }),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: none,
  },
  {
    given: 'a Round just before the attendance cutoff',
    view: ballot('active', { state: 'awaiting_attendance', deadlineAt }),
    pastDeadlineMs: -1,
    expected: steadily,
  },
  {
    given: 'a Round whose attendance cutoff the server never moved past',
    view: ballot('active', { state: 'awaiting_attendance', deadlineAt }),
    pastDeadlineMs: ballotRefreshGraceMs,
    expected: none,
  },
  {
    given: 'a Round the page has just seen begin settling',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 0,
    expected: steadily,
  },
  {
    given: 'a Round the page has seen settling for half a minute',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 30_000,
    expected: steadily,
  },
  {
    given: 'a Round the page has seen settling for two minutes',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: inMs(20_000),
  },
  {
    given: 'a Round the page has seen settling for an hour',
    view: ballot('active', { state: 'settling' }),
    pastDeadlineMs: minute,
    waitedMs: 60 * minute,
    expected: inMs(ballotRefreshCeilingMs),
  },
  {
    given: 'a Round whose transcript has been closing for two minutes',
    view: ballot('active', { state: 'closing_transcript' }),
    pastDeadlineMs: -minute,
    waitedMs: 2 * minute,
    expected: inMs(20_000),
  },
  {
    given: 'a Round held by a writer for two minutes',
    view: ballot('active', { state: 'held_by_writer' }),
    pastDeadlineMs: -minute,
    waitedMs: 2 * minute,
    expected: inMs(20_000),
  },
  {
    given: 'a Round whose AI judge has been recovering for two minutes',
    view: ballot('active', { state: 'ai_recovering' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: inMs(20_000),
  },
  {
    given: 'a Round whose AI judge failed two minutes ago and is yet to settle',
    view: ballot('active', { state: 'ai_failed' }),
    pastDeadlineMs: minute,
    waitedMs: 2 * minute,
    expected: inMs(20_000),
  },
  {
    given: 'a Round whose AI judge is blocked, the moment the page sees it',
    view: ballot('active', { state: 'ai_blocked' }),
    pastDeadlineMs: -minute,
    waitedMs: 0,
    expected: none,
  },
  {
    given: 'an unacknowledged ballot holding a Round’s page inside its window',
    view: ballot('active', humanWindow),
    held: true,
    pastDeadlineMs: -minute,
    expected: none,
  },
  {
    given: 'an unacknowledged ballot holding a Round whose speeches still run',
    view: ballot('active', null),
    held: true,
    pastDeadlineMs: -minute,
    expected: none,
  },
  {
    given: 'a completed Round, before the deadline it once carried',
    view: ballot('completed', humanWindow),
    pastDeadlineMs: -minute,
    expected: none,
  },
  {
    given: 'a completed Round that waits on nothing',
    view: ballot('completed', null),
    pastDeadlineMs: -minute,
    expected: none,
  },
  {
    given: 'a Round still opening',
    view: ballot('opening', null),
    pastDeadlineMs: -minute,
    expected: none,
  },
  {
    given:
      'a judging window that closed a minute ago, on a page rendered two minutes ago',
    view: ballot('active', humanWindow),
    pastDeadlineMs: minute,
    renderedAgoMs: 2 * minute,
    expected: once,
  },
  {
    given:
      'a judging window whose grace has just run out, on a page last rendered inside it',
    view: ballot('active', humanWindow),
    pastDeadlineMs: ballotRefreshGraceMs,
    renderedAgoMs: ballotRefreshEveryMs,
    expected: once,
  },
  {
    given:
      'the render that one refresh brought, still naming the window closed a minute ago',
    view: ballot('active', humanWindow),
    pastDeadlineMs: minute + ballotRefreshEveryMs,
    renderedAgoMs: ballotRefreshEveryMs,
    expected: none,
  },
  {
    given:
      'an AI judge’s deadline that passed a minute ago, on a page rendered before it',
    view: ballot('active', { state: 'ai_processing', deadlineAt }),
    pastDeadlineMs: minute,
    renderedAgoMs: 2 * minute,
    expected: once,
  },
  {
    given:
      'an attendance cutoff that passed a minute ago, on a page rendered before it',
    view: ballot('active', { state: 'awaiting_attendance', deadlineAt }),
    pastDeadlineMs: minute,
    renderedAgoMs: 2 * minute,
    expected: once,
  },
  {
    given: 'a blocked AI judge on a page rendered an hour ago',
    view: ballot('active', { state: 'ai_blocked' }),
    pastDeadlineMs: minute,
    renderedAgoMs: 60 * minute,
    expected: none,
  },
  {
    given:
      'an unacknowledged ballot holding a page whose window closed since it was rendered',
    view: ballot('active', humanWindow),
    held: true,
    pastDeadlineMs: minute,
    renderedAgoMs: 2 * minute,
    expected: none,
  },
  {
    given:
      'a completed Round whose old deadline passed since the page was rendered',
    view: ballot('completed', humanWindow),
    pastDeadlineMs: minute,
    renderedAgoMs: 2 * minute,
    expected: none,
  },
];

for (const {
  given,
  view,
  held = false,
  pastDeadlineMs,
  waitedMs = 0,
  renderedAgoMs = 0,
  expected,
} of cases)
  test(`ballot refresh: ${given}`, () => {
    const nowMs = deadline + pastDeadlineMs;
    assert({
      given,
      should:
        expected.kind === 'in'
          ? `refresh the Round in ${expected.ms / 1000} s`
          : expected.kind === 'once'
            ? 'refresh the Round once, now'
            : 'not refresh the Round',
      actual: ballotRefresh(view, held, {
        nowMs,
        waitingSinceMs: nowMs - waitedMs,
        renderedAtMs: nowMs - renderedAgoMs,
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
