import type { WatchDebate } from './debate';
import { isListedLive } from './live-list';

/** The numbers on the hub's tabs: what is live and what the archive holds. */
export type HubCounts = {
  readonly live: number;
  readonly recordings: number;
};

/** Counts public live debates and public, replayable recordings. */
export const hubCounts = (debates: readonly WatchDebate[]): HubCounts => ({
  live: debates.filter(isListedLive).length,
  recordings: debates.filter(
    (debate) =>
      debate.visibility === 'public' &&
      debate.state.status === 'ended' &&
      debate.state.recording.availability === 'ready',
  ).length,
});
