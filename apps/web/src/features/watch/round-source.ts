import type { SpeechPhase, WatchRound, WatchViewer } from './round';
import type { Turn } from './schedule';
import type { Following, SpectatorSocial } from './social';

/**
 * What Watch reads, injected into its flow drivers so the rules never reach
 * for a store. The real listing, Broadcast and Recording reads fill this;
 * until they exist `watchSource` holds nothing, so every screen shows its
 * empty state and never a sample.
 */
export type WatchSource = {
  /** Every Round the viewer might be shown; each caller filters by rule. */
  readonly rounds: readonly WatchRound[];
  /** Seconds spectators watch behind the Round. */
  readonly delaySeconds: number;
  /** The Round's timetable: its speech slots and the turns spoken in them. */
  readonly schedule: (round: WatchRound) => {
    readonly phases: readonly SpeechPhase[];
    readonly turns: readonly Turn[];
  };
  /** Context lines a Round shows: its resolution, season and spectator delay. */
  readonly context: (round: WatchRound) => {
    readonly resolution: string;
    readonly season: string;
    readonly delaySeconds: number;
  };
  /** The reaction density drawn under a replay's timeline. */
  readonly density: (round: WatchRound) => readonly number[];
  /** The spectators' reactions and chat for a live Round. */
  readonly social: (round: WatchRound) => SpectatorSocial;
  /** Who the viewer follows, and what they recently watched (private to them). */
  readonly following: (viewer: WatchViewer) => Following;
};

/** The one delay every Round starts from (owner decision 2026-11-02). */
const DEFAULT_DELAY_SECONDS = 60;

/** Nothing is listed, opened or followed until the real reads exist. */
export const watchSource: WatchSource = {
  rounds: [],
  delaySeconds: DEFAULT_DELAY_SECONDS,
  schedule: () => ({ phases: [], turns: [] }),
  context: () => ({
    resolution: '',
    season: '',
    delaySeconds: DEFAULT_DELAY_SECONDS,
  }),
  density: () => [],
  social: () => ({ reactions: [], messages: [] }),
  following: () => ({ people: [], history: [] }),
};

/** One Round by id, or null when there is none. */
export const findRound = (source: WatchSource, id: string): WatchRound | null =>
  source.rounds.find((round) => round.id === id) ?? null;
