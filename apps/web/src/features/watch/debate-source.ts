import {
  sampleChat,
  sampleChatRules,
  sampleDelaySeconds,
  sampleFollowing,
  sampleHistory,
  samplePhases,
  sampleReactions,
  sampleResolution,
  sampleSeason,
  sampleTurns,
  sampleViewer,
} from '../../ui/mock/watch';
import { sampleDebates } from '../../ui/mock/watch-debates';
import type { SpeechPhase, WatchDebate, WatchViewer } from './debate';
import type { Turn } from './schedule';
import type { Following, SpectatorSocial } from './social';

/**
 * Watch's data seams. Today each reads the sample debates; the backend reads
 * (a debate by id, the public live listing, the viewer's follows and
 * history, the room's spectator chat and reactions) replace these functions
 * and nothing else. Nothing outside this file imports the mock.
 */

/** Every debate the viewer might be shown; each caller filters by rule. */
export const listDebates = (): readonly WatchDebate[] => sampleDebates;

/** One debate by id, or null when there is none. */
export const findDebate = (id: string): WatchDebate | null =>
  sampleDebates.find((debate) => debate.id === id) ?? null;

/** The viewer for this request: nobody, or the sample signed-in member. */
export const watchViewer = (signedIn: boolean): WatchViewer =>
  signedIn ? sampleViewer : { signedIn: false };

/** The debate's timetable: its speech slots and the turns spoken in them. */
export const debateSchedule = (
  _debate: WatchDebate,
): {
  readonly phases: readonly SpeechPhase[];
  readonly turns: readonly Turn[];
} => ({
  phases: samplePhases,
  turns: sampleTurns,
});

/** Context lines a debate shows: its resolution, season and spectator delay. */
export const debateContext = (
  _debate: WatchDebate,
): {
  readonly resolution: string;
  readonly season: string;
  readonly delaySeconds: number;
} => ({
  resolution: sampleResolution,
  season: sampleSeason,
  delaySeconds: sampleDelaySeconds,
});

/** Seconds spectators watch behind the debate. */
export const spectatorDelaySeconds = sampleDelaySeconds;

/** The spectators' reactions and chat for a live debate. */
export const spectatorSocial = (_debate: WatchDebate): SpectatorSocial => ({
  reactions: sampleReactions,
  messages: sampleChat,
  chatRules: sampleChatRules,
});

/** Who the viewer follows, and what they recently watched (private to them). */
export const followingOf = (viewer: WatchViewer): Following =>
  viewer.signedIn
    ? { people: sampleFollowing, history: sampleHistory }
    : { people: [], history: [] };
