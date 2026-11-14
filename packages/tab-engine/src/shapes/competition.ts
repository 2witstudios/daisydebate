/**
 * The plain data a tab round is drawn from. Every id is an opaque string the
 * caller supplies; the engine mints none. Every number is an integer:
 * speaker points arrive in the ballot's own smallest step.
 */
export type Id = string;

/** What a Room runs, as far as a draw needs to know. */
export type TwoSides = { readonly outcome: 'winner'; readonly sides: 2 };
export type FourSides = {
  readonly outcome: 'ranking';
  readonly of: 'sides';
  readonly sides: 4;
};
export type Speakers = { readonly outcome: 'ranking'; readonly of: 'speakers' };
export type FormatDescriptor = TwoSides | FourSides | Speakers;

/** A keyed protection scope; `school` is the one version 1 reads. */
export type ProtectionKey = { readonly scope: string; readonly key: string };

/** A person or team entered in an event. */
export type Entry = {
  readonly id: Id;
  readonly members: readonly Id[];
  readonly protection: readonly ProtectionKey[];
  readonly division: Id | null;
  /** Accepted entries are active; a withdrawn one is never placed. */
  readonly status: 'active' | 'withdrawn';
  readonly breakEligible: boolean;
};

/** Judge ids in seat order; seat 0 is the chair. */
type Panel = readonly Id[];

export type TwoSidePairing = {
  readonly kind: 'pairing';
  /** Entries by side, in the format's side order. */
  readonly sides: readonly [Id, Id];
  readonly panel: Panel;
};
export type FourSidePairing = {
  readonly kind: 'pairing';
  /** Entries by position, in the format's position order. */
  readonly sides: readonly [Id, Id, Id, Id];
  readonly panel: Panel;
};
export type Section = {
  readonly kind: 'section';
  /** Entries in speaker order. */
  readonly speakers: readonly Id[];
  readonly panel: Panel;
};
/** A bye has no Room and occupies nobody. */
export type Bye = { readonly kind: 'bye'; readonly entry: Id };

/** The fixture a format can hold: its kind follows from the format. */
export type FixtureOf<Format extends FormatDescriptor> = Format extends TwoSides
  ? TwoSidePairing | Bye
  : Format extends FourSides
    ? FourSidePairing | Bye
    : Section | Bye;
export type Fixture = TwoSidePairing | FourSidePairing | Section | Bye;

/** One judge's ballot in a two-sided Round. `winner: null` is a loss to both. */
type WinnerBallot = {
  readonly judge: Id;
  readonly winner: Id | null;
  readonly points: readonly { readonly entry: Id; readonly points: number }[];
};
/** One judge's ranks in a ranked Round. */
type RankBallot = {
  readonly judge: Id;
  readonly ranks: readonly {
    readonly entry: Id;
    readonly rank: number;
    readonly points: number;
  }[];
};
type WinnerOutcome = {
  readonly kind: 'winner';
  /** Null is a double loss. */
  readonly winner: Id | null;
  readonly ballots: readonly WinnerBallot[];
};
type RankingOutcome = {
  readonly kind: 'ranking';
  /** The decided place of each entry, 1 the best. */
  readonly places: readonly { readonly entry: Id; readonly place: number }[];
  readonly ballots: readonly RankBallot[];
};
type OutcomeOf<Format extends FormatDescriptor> = Format extends TwoSides
  ? WinnerOutcome
  : RankingOutcome;

/** The outcome of a fixture. A correction supersedes an earlier result. */
export type ResultOf<Format extends FormatDescriptor> = {
  readonly id: Id;
  readonly fixture: Id;
  readonly kind: 'decided' | 'administrative';
  readonly supersedes: Id | null;
  readonly certified: boolean;
  readonly outcome: OutcomeOf<Format>;
};
export type Result =
  ResultOf<TwoSides> | ResultOf<FourSides> | ResultOf<Speakers>;

/** A standing fixture of an earlier tab round (withdrawn ones left out). */
export type HistoricFixture<Format extends FormatDescriptor> = {
  readonly id: Id;
  readonly tabRound: number;
  readonly fixture: FixtureOf<Format>;
};

/** Every standing fixture of the stage's earlier tab rounds, and every result. */
export type StageHistory<Format extends FormatDescriptor> = {
  readonly fixtures: readonly HistoricFixture<Format>[];
  readonly results: readonly ResultOf<Format>[];
};

/** A rating read once, at tournament start, from one ladder. */
export type EntryRating =
  | {
      readonly status: 'rated';
      readonly rating: number;
      readonly deviation: number;
    }
  | { readonly status: 'unrated' };
export type RatingSnapshot = {
  readonly ladder: Id;
  readonly takenAt: string;
  readonly calculation: string;
  readonly entries: readonly ({ readonly entry: Id } & EntryRating)[];
};

/** The standard seeded tree: `seeds[0]` is seed 1. */
export type Bracket = { readonly seeds: readonly Id[] };

export type Stage =
  | { readonly kind: 'preliminary' }
  | {
      readonly kind: 'elimination';
      readonly division: Id | null;
      readonly bracket: Bracket;
    };
