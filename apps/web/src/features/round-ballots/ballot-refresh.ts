import type { RoundBallotRead } from '@daisy/protocol';

/** How often the ballot page asks the server for the Round again. */
export const ballotRefreshEveryMs = 5_000;

/**
 * How long past a deadline the page still refreshes. The server only moves a
 * Round on once its deadline is behind it, so the refresh that sees the move
 * is one sent after the deadline; two intervals leave room for that refresh
 * and for one that fails.
 */
export const ballotRefreshGraceMs = 2 * ballotRefreshEveryMs;

type RefreshedBallot = {
  readonly round: Pick<RoundBallotRead['round'], 'status' | 'waitingOn'>;
  readonly freeze: RoundBallotRead['freeze'];
};

/**
 * Whether the ballot page keeps refreshing the Round at `nowMs`, on the
 * server-anchored count. An active Round is refreshed until it freezes, then
 * until the deadline it waits on is behind it by the grace. A frozen Round
 * that names no deadline (settling, an AI judge recovering) is still going to
 * change with nothing on the page to say when, so it is refreshed for as long
 * as it stays active. A ballot being posted, or one left unacknowledged, holds
 * the page (`held`): a refresh would race the answer or lose the original retry.
 */
export function ballotKeepsRefreshing(
  view: RefreshedBallot,
  held: boolean,
  nowMs: number,
): boolean {
  if (view.round.status !== 'active' || held) return false;
  const waitingOn = view.round.waitingOn;
  if (!view.freeze || !waitingOn || !('deadlineAt' in waitingOn)) return true;
  return nowMs < Date.parse(waitingOn.deadlineAt) + ballotRefreshGraceMs;
}
