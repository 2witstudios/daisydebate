import type {
  Entry,
  FixtureOf,
  FormatDescriptor,
  FourSides,
  Id,
  ProtectionKey,
  RatingSnapshot,
  Speakers,
  Stage,
  StageHistory,
  TwoSides,
} from './competition';
import type { Force, ForceKey, ResolvedSettings, SettingKey } from './settings';

/** A fixture the tab round already has. Fixed is kept as it is; movable is kept or withdrawn. */
export type ExistingFixture<Format extends FormatDescriptor> = {
  readonly id: Id;
  readonly fixture: FixtureOf<Format>;
  readonly hold: 'fixed' | 'movable';
};

/** One event whose tab round is drawn now. */
export type RequestOf<Format extends FormatDescriptor> = {
  readonly event: Id;
  readonly format: Format;
  readonly stage: Stage;
  readonly tabRound: number;
  readonly entries: readonly Entry[];
  readonly history: StageHistory<Format>;
  readonly settings: ResolvedSettings;
  /** Results count through this tab round; 0 counts none. */
  readonly cutoff: number;
  readonly ratings: RatingSnapshot | null;
  readonly existing: readonly ExistingFixture<Format>[];
};
export type EventRequest =
  RequestOf<TwoSides> | RequestOf<FourSides> | RequestOf<Speakers>;

/** A tournament judge, as a draw needs them. */
export type Judge = {
  readonly id: Id;
  readonly person: Id;
  readonly protection: readonly ProtectionKey[];
  /** The events they may judge; null is every event. */
  readonly events: readonly Id[] | null;
  /** Entries they declared a conflict with, and entries that struck them. */
  readonly conflicts: readonly Id[];
  readonly strikes: readonly Id[];
  /** Entries they have judged before in this tournament. */
  readonly judged: readonly Id[];
  readonly tabRoundsJudged: number;
  readonly outstandingBallots: number;
  readonly chair: boolean;
};
/** In a time slot, availability is a fact of the judge for that slot. */
export type SlotJudge = Judge & { readonly available: boolean };

/** Another event's fixture already in the slot: fixed, never moved. */
export type Commitment = {
  readonly event: Id;
  readonly fixture: Id;
  /** Entry members and judges it occupies. */
  readonly people: readonly Id[];
};

/** A time slot with one or more events, or one tab round of a windowed stage. */
export type DrawInput =
  | {
      readonly call: 'slot';
      readonly slot: Id;
      readonly events: readonly EventRequest[];
      readonly judges: readonly SlotJudge[] | null;
      readonly commitments: readonly Commitment[];
      readonly seed: Uint8Array;
    }
  | {
      readonly call: 'windowed';
      readonly event: EventRequest;
      readonly judges: readonly Judge[] | null;
      readonly seed: Uint8Array;
    };

/** How a fixture in a plan is addressed: by its id, or a new one by ordinal. */
export type FixtureRef =
  | { readonly kind: 'existing'; readonly id: Id }
  | { readonly kind: 'new'; readonly ordinal: number };

/** A cost key: a force key, or a plain key whose term is weighed. */
export type CostKey = ForceKey | 'pairing.method' | 'bye.recipient' | 'keep';

export type TermCost = {
  readonly key: CostKey;
  /** Null for a plain key, which carries no force. */
  readonly force: Force | null;
  readonly cost: readonly number[];
};

export type RuleBreak = {
  readonly event: Id;
  readonly key: ForceKey;
  readonly fixture: FixtureRef;
};

/** A structural fact no override covers. */
export type InvalidFact =
  | {
      readonly fact: 'entry_placed_twice';
      readonly event: Id;
      readonly entry: Id;
    }
  | {
      readonly fact: 'entry_not_placed';
      readonly event: Id;
      readonly entry: Id;
    }
  | {
      readonly fact: 'withdrawn_entry_placed';
      readonly event: Id;
      readonly entry: Id;
    }
  | { readonly fact: 'person_twice_in_slot'; readonly person: Id }
  | {
      readonly fact: 'fixed_fixture_changed';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly fact: 'seated_judge_removed';
      readonly event: Id;
      readonly fixture: Id;
    }
  | { readonly fact: 'judge_twice'; readonly judge: Id }
  | {
      readonly fact: 'judge_not_eligible';
      readonly judge: Id;
      readonly event: Id;
    }
  | {
      readonly fact: 'fixture_kind';
      readonly event: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly fact: 'panel_size';
      readonly event: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly fact: 'existing_unaccounted';
      readonly event: Id;
      readonly fixture: Id;
    };

/** The best single exchange of one entry with another fixture, field by field. */
export type Exchange = {
  readonly with: FixtureRef;
  readonly entries: readonly [Id, Id];
  readonly difference: readonly {
    readonly key: CostKey;
    readonly cost: readonly number[];
  }[];
};

export type FixtureAssessment = {
  readonly fixture: FixtureRef;
  readonly terms: readonly TermCost[];
  readonly exchange: Exchange | null;
};

/** The one costing of a plan, engine-made or changed by a person. */
export type Assessment = {
  readonly fixtures: readonly FixtureAssessment[];
  readonly totals: readonly {
    readonly key: CostKey;
    readonly cost: readonly number[];
  }[];
  readonly warnings: readonly RuleBreak[];
  readonly broken: readonly RuleBreak[];
  readonly invalid: readonly InvalidFact[];
};

/** What a draw was computed from. The caller stores it with the draw. */
export type InputsRecord = {
  readonly engine: Readonly<Record<string, string>>;
  readonly settings: Partial<Readonly<Record<SettingKey, unknown>>>;
  readonly settingsDigest: string;
  readonly seed: string;
  readonly slot: Id | null;
  readonly entriesDigest: string;
  readonly judgesDigest: string;
  readonly existing: readonly {
    readonly id: Id;
    readonly hold: 'fixed' | 'movable';
  }[];
  readonly commitments: readonly Id[];
  readonly alongside: readonly {
    readonly event: Id;
    readonly tabRound: number;
  }[];
  readonly ratings: {
    readonly ladder: Id;
    readonly takenAt: string;
    readonly calculation: string;
  } | null;
  /** Results counted through this tab round. */
  readonly cutoff: number;
  readonly results: readonly Id[];
};

type KeptFixture<Format extends FormatDescriptor> = {
  readonly id: Id;
  readonly fixture: FixtureOf<Format>;
};
export type NewFixture<Format extends FormatDescriptor> = {
  readonly ordinal: number;
  readonly fixture: FixtureOf<Format>;
};

/** One event's plan for its tab round: keep, add and withdraw. */
export type DrawOf<Format extends FormatDescriptor> = {
  readonly event: Id;
  readonly format: Format;
  readonly tabRound: number;
  readonly keep: readonly KeptFixture<Format>[];
  readonly add: readonly NewFixture<Format>[];
  readonly withdraw: readonly Id[];
  readonly assessment: Assessment;
  readonly inputs: InputsRecord;
};
export type Draw = DrawOf<TwoSides> | DrawOf<FourSides> | DrawOf<Speakers>;

/** A plan as a person may hand it back: the three lists, without costs. */
type PlanOf<Format extends FormatDescriptor> = Pick<
  DrawOf<Format>,
  'event' | 'keep' | 'add' | 'withdraw'
>;
export type Plan = PlanOf<TwoSides> | PlanOf<FourSides> | PlanOf<Speakers>;

/** Who collided on a structural fact of the slot. */
export type Collision = {
  readonly person: Id;
  readonly holders: readonly (
    | { readonly kind: 'entry'; readonly event: Id; readonly entry: Id }
    | { readonly kind: 'commitment'; readonly event: Id; readonly fixture: Id }
  )[];
};

export type ShortFixture = {
  readonly event: Id;
  readonly fixture: FixtureRef;
  readonly missing: number;
  /** Judges who could have sat here but for the rules or a commitment. */
  readonly couldCover: readonly Id[];
};

export type DrawAnswer =
  | { readonly kind: 'drawn'; readonly draws: readonly Draw[] }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'slot';
      readonly collisions: readonly Collision[];
    }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'rules';
      readonly event: Id;
      /** A set in which dropping any one rule makes a draw possible. */
      readonly rules: readonly ForceKey[];
      /** What each single relaxation to a preference would cost, as information. */
      readonly relaxations: readonly {
        readonly key: ForceKey;
        readonly breaks: number;
      }[];
    }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'panels';
      readonly short: readonly ShortFixture[];
      readonly removed: readonly {
        readonly key: ForceKey;
        readonly judges: number;
      }[];
      readonly committed: number;
      /** The fixtures, with the panels that could be seated, for the host to see. */
      readonly draws: readonly Draw[];
    }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'structure';
      readonly event: Id;
      readonly fact: 'missing_result' | 'no_plan';
      readonly fixture: Id | null;
    }
  | {
      readonly kind: 'unresolved';
      readonly event: Id;
      readonly method: string;
      readonly attempt: Draw;
      readonly broken: readonly RuleBreak[];
    };
