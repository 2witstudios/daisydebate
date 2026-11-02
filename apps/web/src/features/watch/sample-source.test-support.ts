import {
  sampleChat,
  sampleDelaySeconds,
  sampleDensity,
  sampleFollowing,
  sampleHistory,
  samplePhases,
  sampleReactions,
  sampleResolution,
  sampleSeason,
  sampleTurns,
  sampleViewer,
} from '../../ui/mock/watch';
import { sampleRounds } from '../../ui/mock/watch-rounds';
import type { WatchRound, WatchViewer } from './round';
import { findRound as findIn, type WatchSource } from './round-source';

/** The design fixtures as a source, for tests of the rules and screens. */
export const sampleWatchSource: WatchSource = {
  rounds: sampleRounds,
  delaySeconds: sampleDelaySeconds,
  schedule: () => ({ phases: samplePhases, turns: sampleTurns }),
  context: () => ({
    resolution: sampleResolution,
    season: sampleSeason,
    delaySeconds: sampleDelaySeconds,
  }),
  density: () => sampleDensity,
  social: () => ({
    reactions: sampleReactions,
    messages: sampleChat,
  }),
  following: (viewer) =>
    viewer.signedIn
      ? { people: sampleFollowing, history: sampleHistory }
      : { people: [], history: [] },
};

/** The sample member, or a visitor. */
export const watchViewer = (signedIn: boolean): WatchViewer =>
  signedIn ? sampleViewer : { signedIn: false };

export const findRound = (id: string): WatchRound | null =>
  findIn(sampleWatchSource, id);

export const followingOf = sampleWatchSource.following;
export const roundContext = sampleWatchSource.context;
export const roundSchedule = sampleWatchSource.schedule;
export const spectatorSocial = sampleWatchSource.social;
