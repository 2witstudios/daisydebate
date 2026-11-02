import type { WatchRound } from './round';
import { isListedLive } from './live-list';

/** The numbers on the hub's tabs: what is live and what the archive holds. */
export type HubCounts = {
  readonly live: number;
  readonly recordings: number;
};

/** Counts public live Rounds and public, replayable recordings. */
export const hubCounts = (rounds: readonly WatchRound[]): HubCounts => ({
  live: rounds.filter(isListedLive).length,
  recordings: rounds.filter(
    (round) =>
      round.visibility === 'public' &&
      round.state.status === 'ended' &&
      round.state.recording.availability === 'ready',
  ).length,
});
