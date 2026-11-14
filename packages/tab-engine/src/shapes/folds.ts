import type {
  Bracket,
  Entry,
  FormatDescriptor,
  FourSides,
  Id,
  RatingSnapshot,
  ResultOf,
  Speakers,
  StageHistory,
  TwoSides,
  TwoSidePairing,
} from './competition';
import type { Metric, ResolvedSettings } from './settings';

/** An exact fraction; a total has denominator 1. */
export type Rational = { readonly n: number; readonly d: number };

/** An event's preliminary record, as standings and breaks read it. */
export type StandingsInputOf<Format extends FormatDescriptor> = {
  readonly format: Format;
  readonly entries: readonly Entry[];
  readonly history: StageHistory<Format>;
  readonly settings: ResolvedSettings;
  /** Results count through this tab round; 0 counts none. */
  readonly cutoff: number;
  readonly ratings: RatingSnapshot | null;
  /** Rows of this division only; every result still counts. */
  readonly division: Id | null;
  readonly seed: Uint8Array;
};
export type StandingsInput =
  | StandingsInputOf<TwoSides>
  | StandingsInputOf<FourSides>
  | StandingsInputOf<Speakers>;

export type StandingsRow = {
  readonly entry: Id;
  /** Null when the entry is below the minimum games and so unranked. */
  readonly rank: number | null;
  readonly games: number;
  readonly values: readonly { readonly metric: Metric; readonly value: readonly Rational[] }[];
  /** What put this row below the one above: a metric, the lot, a shared tie, or none for the first. */
  readonly separatedBy: Metric | 'lot' | 'shared' | 'minimum_games' | null;
};

export type Standings = {
  readonly rows: readonly StandingsRow[];
  /** False when no rating snapshot was given, so every entry is unrated. */
  readonly rated: boolean;
  /** Exactly the results counted: the latest correction of each, at or before the cutoff. */
  readonly results: readonly Id[];
};

/** An elimination stage that breaks from the preliminary stage. */
export type BreakStage = { readonly id: Id; readonly division: Id | null };

export type BreaksInput = (
  | Omit<StandingsInputOf<TwoSides>, 'division'>
  | Omit<StandingsInputOf<FourSides>, 'division'>
  | Omit<StandingsInputOf<Speakers>, 'division'>
) & {
  /** Highest precedence first. */
  readonly stages: readonly BreakStage[];
  /** Under `choice`: the stage each double qualifier chose. */
  readonly choices: Readonly<Record<Id, Id>>;
};

export type BreaksAnswer =
  | {
      readonly kind: 'resolved';
      readonly stages: readonly {
        readonly stage: Id;
        /** Qualified entries in seed order. */
        readonly bracket: Bracket;
      }[];
    }
  | {
      readonly kind: 'undecided';
      readonly entries: readonly { readonly entry: Id; readonly stages: readonly Id[] }[];
    };

/** One event's record as a league's season reads it. */
export type SeasonEventOf<Format extends FormatDescriptor> = {
  readonly event: Id;
  readonly sanctioned: boolean;
  readonly format: Format;
  readonly entries: readonly {
    readonly entry: Id;
    /** Who the season counts: a person or a standing team. */
    readonly competitor: Id;
    readonly school: Id | null;
  }[];
  readonly preliminary: StageHistory<Format>;
  readonly elimination: StageHistory<Format>;
};
export type SeasonEvent =
  | SeasonEventOf<TwoSides>
  | SeasonEventOf<FourSides>
  | SeasonEventOf<Speakers>;

/** A league's declarative season formula. */
export type SeasonFormula = {
  readonly preliminaryWin: { readonly points: number; readonly cap: number | null };
  readonly eliminationRound: { readonly points: number };
  readonly bestEvents: number | null;
  readonly topPerSchool: number | null;
};

export type SeasonStandings = {
  readonly rows: readonly {
    readonly competitor: Id;
    readonly points: number;
    readonly events: readonly { readonly event: Id; readonly points: number }[];
  }[];
  /** A term the fold could not evaluate for an entry: shown, never guessed. */
  readonly exceptions: readonly {
    readonly competitor: Id;
    readonly event: Id;
    readonly term: 'preliminary_win' | 'elimination_round';
    readonly reason: 'no_winner_in_format' | 'competitor_twice_in_event';
  }[];
};

/** A two-sided game a league's ladder may rate. */
export type LadderGame = {
  readonly result: Id;
  readonly source: 'league_room' | 'tournament';
  readonly playedAt: string;
  readonly sides: readonly [readonly Id[], readonly Id[]];
  readonly winner: 0 | 1;
};

export type LadderInput = {
  /** The league lobby's own rated games, as the caller read them. */
  readonly rooms: readonly LadderGame[];
  /** Tournaments run on Daisy. */
  readonly tournaments: readonly {
    readonly event: Id;
    readonly sanctioned: boolean;
    readonly entries: readonly Pick<Entry, 'id' | 'members'>[];
    readonly results: readonly {
      readonly result: ResultOf<TwoSides>;
      readonly fixture: TwoSidePairing;
      readonly playedAt: string;
    }[];
  }[];
};
