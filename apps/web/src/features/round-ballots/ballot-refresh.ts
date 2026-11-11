import type { RoundBallotRead, RoundWaitingOn } from '@daisy/protocol';

/** How soon the ballot page asks the server for the Round again while a change is due. */
export const ballotRefreshEveryMs = 5_000;

/** The slowest the page asks while a Round waits on something that names no deadline. */
export const ballotRefreshCeilingMs = 60_000;

/**
 * How long past a deadline the page still refreshes. The server only moves a
 * Round on once its deadline is behind it, so the refresh that sees the move
 * is one sent after the deadline; two intervals leave room for that refresh
 * and for one that fails.
 */
export const ballotRefreshGraceMs = 2 * ballotRefreshEveryMs;

/** A wait with no deadline is asked about at a sixth of the time it has lasted. */
const waitShareAsked = 6;

type RefreshedBallot = {
  readonly round: Pick<RoundBallotRead['round'], 'status' | 'waitingOn'>;
};

/** What the page last saw the Round waiting on, and the server instant it first saw it. */
export type BallotWait = {
  readonly state: RoundWaitingOn['state'] | null;
  readonly sinceMs: number;
};

/**
 * The wait the page is in after a render: kept while the Round still waits on
 * the same thing, so a refresh that brings nothing new does not restart the
 * back-off; a new wait starts at this render's instant.
 */
export const ballotWaitSince = (
  previous: BallotWait | null,
  waitingOn: RoundWaitingOn | null,
  renderedAtMs: number,
): BallotWait => {
  const state = waitingOn?.state ?? null;
  return previous?.state === state
    ? previous
    : { state, sinceMs: renderedAtMs };
};

/** The present on the server-anchored count, and when the page first saw this wait. */
type RefreshInstant = {
  readonly nowMs: number;
  readonly waitingSinceMs: number;
};

const untilDeadline = (deadlineAt: string, nowMs: number) =>
  nowMs < Date.parse(deadlineAt) + ballotRefreshGraceMs
    ? ballotRefreshEveryMs
    : null;

const backingOff = (waitedMs: number) =>
  Math.min(
    ballotRefreshCeilingMs,
    Math.max(ballotRefreshEveryMs, Math.floor(waitedMs / waitShareAsked)),
  );

/** How soon a Round is asked about again, by what it waits on. */
const whileWaitingOn = (
  waitingOn: RoundWaitingOn,
  { nowMs, waitingSinceMs }: RefreshInstant,
): number | null => {
  switch (waitingOn.state) {
    case 'human_window':
    case 'ai_processing':
    case 'awaiting_attendance':
      return untilDeadline(waitingOn.deadlineAt, nowMs);
    case 'closing_transcript':
    case 'held_by_writer':
    case 'ai_recovering':
    case 'ai_failed':
    case 'settling':
      return backingOff(nowMs - waitingSinceMs);
    case 'ai_blocked':
      return null;
  }
};

/**
 * How long until the ballot page next refreshes the Round, on the
 * server-anchored count; null when it does not. Only an active Round is
 * refreshed, and what it waits on decides how:
 *
 * - speeches still running (no wait named): steadily, the Round's own clock
 *   ends them;
 * - a persisted deadline: steadily until the deadline is behind it by the grace;
 * - a wait the server ends by itself but dates nowhere: ever more slowly the
 *   longer the page has seen it, up to the ceiling, so a stuck Round costs a
 *   request a minute rather than one every interval;
 * - a blocked AI judge: never, since only an operator moves it on.
 *
 * A ballot being posted, or one left unacknowledged, holds the page (`held`):
 * a refresh would race the answer or lose the original retry.
 */
export function ballotRefreshInMs(
  view: RefreshedBallot,
  held: boolean,
  at: RefreshInstant,
): number | null {
  if (view.round.status !== 'active' || held) return null;
  const waitingOn = view.round.waitingOn;
  return waitingOn ? whileWaitingOn(waitingOn, at) : ballotRefreshEveryMs;
}
