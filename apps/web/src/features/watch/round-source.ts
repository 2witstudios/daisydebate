import {
  sampleChat,
  sampleChatRules,
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
import type { SpeechPhase, WatchRound, WatchViewer } from './round';
import type { Turn } from './schedule';
import type { Following, SpectatorSocial } from './social';

/**
 * Watch's data seams. Today each reads the sample Rounds; the backend reads
 * (a Round by id, the public live listing, the viewer's follows and
 * history, the room's spectator chat and reactions) replace these functions
 * and nothing else. Nothing outside this file imports the mock.
 */

/** Every Round the viewer might be shown; each caller filters by rule. */
export const listRounds = (): readonly WatchRound[] => sampleRounds;

/** One Round by id, or null when there is none. */
export const findRound = (id: string): WatchRound | null =>
  sampleRounds.find((round) => round.id === id) ?? null;

/** The viewer for this request: nobody, or the sample signed-in member. */
export const watchViewer = (signedIn: boolean): WatchViewer =>
  signedIn ? sampleViewer : { signedIn: false };

/** The Round's timetable: its speech slots and the turns spoken in them. */
export const roundSchedule = (
  _round: WatchRound,
): {
  readonly phases: readonly SpeechPhase[];
  readonly turns: readonly Turn[];
} => ({
  phases: samplePhases,
  turns: sampleTurns,
});

/** Context lines a Round shows: its resolution, season and spectator delay. */
export const roundContext = (
  _round: WatchRound,
): {
  readonly resolution: string;
  readonly season: string;
  readonly delaySeconds: number;
} => ({
  resolution: sampleResolution,
  season: sampleSeason,
  delaySeconds: sampleDelaySeconds,
});

/** The reaction density drawn under a replay's timeline. */
export const replayDensity = (_round: WatchRound): readonly number[] =>
  sampleDensity;

/** Seconds spectators watch behind the Round. */
export const spectatorDelaySeconds = sampleDelaySeconds;

/** The spectators' reactions and chat for a live Round. */
export const spectatorSocial = (_round: WatchRound): SpectatorSocial => ({
  reactions: sampleReactions,
  messages: sampleChat,
  chatRules: sampleChatRules,
});

/** Who the viewer follows, and what they recently watched (private to them). */
export const followingOf = (viewer: WatchViewer): Following =>
  viewer.signedIn
    ? { people: sampleFollowing, history: sampleHistory }
    : { people: [], history: [] };
