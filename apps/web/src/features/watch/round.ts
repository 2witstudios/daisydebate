/**
 * A Round as Watch shows it (ADR 0049: the Round is the competitive record;
 * the room's visibility decides who may open it). This is a read model for the
 * spectator and replay surfaces, not the stored Round: the backend read that
 * serves a Round to a viewer fills it from `Rounds`, seats, ballots and
 * presence.
 */

export type Visibility = 'public' | 'unlisted' | 'private';
export type RoundMode = 'ranked' | 'casual';
export type Side = 'aff' | 'neg';

/** `provisional` ratings are still settling (few ranked Rounds). */
type Standing = 'established' | 'provisional';

export type Debater = {
  readonly handle: string;
  readonly rating: number;
  readonly standing: Standing;
};

/**
 * One speech slot of the rules' turn order. The order, sides and lengths are
 * placeholders until the rules supply them (ADR 0033 section 5).
 */
export type SpeechPhase = {
  readonly name: string;
  readonly abbreviation: string;
  readonly seconds: number;
  readonly side: Side;
};

/** What one judge decided; judges are shown by number, never by handle. */
export type JudgeBallot = {
  readonly winner: Side;
  readonly affPoints: number;
  readonly negPoints: number;
  readonly reasons: string;
};

type RatingChange = { readonly from: number; readonly to: number };

export type Ballots =
  | {
      readonly state: 'pending';
      readonly received: number;
      readonly of: number;
    }
  | {
      readonly state: 'published';
      readonly winner: Side;
      readonly judgesFor: number;
      readonly judgesAgainst: number;
      readonly aff: RatingChange | null;
      readonly neg: RatingChange | null;
      readonly judges: readonly JudgeBallot[];
    };

/** Whether the recording of an ended Round can be replayed. */
type RecordingAvailability = 'ready' | 'processing' | 'expired';

type Recording = {
  /** UTC ISO timestamp the Round ended. */
  readonly endedAt: string;
  readonly lengthSeconds: number;
  readonly availability: RecordingAvailability;
  /** The retention date shown to the owner; a sample until policy sets it. */
  readonly keptUntil: string | null;
};

type RoundState =
  | {
      readonly status: 'upcoming';
      readonly affReady: boolean;
      readonly negReady: boolean;
    }
  | {
      readonly status: 'live';
      /** Index of the turn being spoken now. */
      readonly turnIndex: number;
      readonly speechSecondsLeft: number;
      readonly watching: number;
    }
  | {
      readonly status: 'ended';
      readonly ballots: Ballots;
      readonly recording: Recording;
    };

export type WatchRound = {
  readonly id: string;
  /** Host-chosen display name. */
  readonly title: string;
  readonly mode: RoundMode;
  readonly customRules: boolean;
  readonly visibility: Visibility;
  readonly aff: Debater;
  readonly neg: Debater;
  /** Judges are assigned by Daisy and stay private to spectators. */
  readonly judges: readonly string[];
  /** Handles the host removed from the audience. */
  readonly removedSpectators: readonly string[];
  /** True when the spectator limit is reached. */
  readonly audienceFull: boolean;
  readonly state: RoundState;
};

/** A viewer with a public name, or a visitor. */
export type WatchViewer =
  | { readonly signedIn: false }
  | {
      readonly signedIn: true;
      readonly handle: string;
    };

export const debaterOn = (round: WatchRound, side: Side): Debater =>
  side === 'aff' ? round.aff : round.neg;

/** The mean of the two debaters' ratings, which ranks a Round. */
export const roundRating = (round: WatchRound): number =>
  Math.round((round.aff.rating + round.neg.rating) / 2);

/** True when the viewer is seated in or assigned to judge the Round. */
export const isParticipant = (
  round: WatchRound,
  viewer: WatchViewer,
): boolean =>
  viewer.signedIn &&
  [round.aff.handle, round.neg.handle, ...round.judges].includes(viewer.handle);
