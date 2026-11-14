/**
 * The port through which `generate-draw`, `assign-judges` and `edit-draw`
 * call the tab engine: its one draw entry point and its assessment of a
 * plan a person changed.
 *
 * Assumption: `@daisy/tab-engine` is being built on the sibling branch
 * `pu/daisy-tab-engines` and is not on this branch, so it is not imported.
 * These types mirror the shapes its public API gives (`draw(input:
 * DrawInput): DrawAnswer` and `assess(input, plans): Assessment[]`, from
 * src/shapes/draw.ts and src/shapes/competition.ts), keeping only what the
 * draw commands read. What the commands pass through untouched (resolved
 * settings, stage history, ratings) is opaque here. When the package lands,
 * wiring adapts `{ draw, assess }` to this port, or these mirrors are
 * replaced by its exported types.
 */

export type EngineId = string;

/** What a Room runs, as far as a draw needs to know. */
export type EngineFormat =
  | { readonly outcome: 'winner'; readonly sides: 2 }
  | { readonly outcome: 'ranking'; readonly of: 'sides'; readonly sides: 4 }
  | { readonly outcome: 'ranking'; readonly of: 'speakers' };

export type EngineProtection = { readonly scope: string; readonly key: string };

export type EngineEntry = {
  readonly id: EngineId;
  readonly members: readonly EngineId[];
  readonly protection: readonly EngineProtection[];
  readonly division: string | null;
  readonly status: 'active' | 'withdrawn';
  readonly breakEligible: boolean;
};

/** Judge ids in seat order; seat 0 is the chair. */
export type EnginePanel = readonly EngineId[];

/** A fixture as the engine sees it; its kind follows from the format. */
export type EngineFixture =
  | {
      readonly kind: 'pairing';
      /** Entries by side or position, in the format's order. */
      readonly sides: readonly EngineId[];
      readonly panel: EnginePanel;
    }
  | {
      readonly kind: 'section';
      /** Entries in speaker order. */
      readonly speakers: readonly EngineId[];
      readonly panel: EnginePanel;
    }
  | { readonly kind: 'bye'; readonly entry: EngineId };

/** A fixture the tab round already has. Fixed is kept as it is; movable is kept or withdrawn. */
export type EngineExistingFixture = {
  readonly id: EngineId;
  readonly fixture: EngineFixture;
  readonly hold: 'fixed' | 'movable';
};

export type EngineStage =
  | { readonly kind: 'preliminary' }
  | {
      readonly kind: 'elimination';
      readonly division: string | null;
      readonly bracket: { readonly seeds: readonly EngineId[] };
    };

/** Opaque here: the engine's own shapes, loaded and passed through as they are. */
export type EngineResolvedSettings = Readonly<Record<string, unknown>>;
export type EngineStageHistory = {
  readonly fixtures: readonly unknown[];
  readonly results: readonly unknown[];
};
export type EngineRatings = Readonly<Record<string, unknown>> | null;

export type EngineEventRequest = {
  readonly event: EngineId;
  readonly format: EngineFormat;
  readonly stage: EngineStage;
  readonly tabRound: number;
  readonly entries: readonly EngineEntry[];
  readonly history: EngineStageHistory;
  readonly settings: EngineResolvedSettings;
  /** Results count through this tab round; 0 counts none. */
  readonly cutoff: number;
  readonly ratings: EngineRatings;
  readonly existing: readonly EngineExistingFixture[];
};

export type EngineJudge = {
  readonly id: EngineId;
  readonly person: EngineId;
  readonly protection: readonly EngineProtection[];
  /** The events they may judge; null is every event. */
  readonly events: readonly EngineId[] | null;
  readonly conflicts: readonly EngineId[];
  readonly strikes: readonly EngineId[];
  readonly judged: readonly EngineId[];
  readonly tabRoundsJudged: number;
  readonly outstandingBallots: number;
  readonly chair: boolean;
};
/** In a time slot, availability is a fact of the judge for that slot. */
export type EngineSlotJudge = EngineJudge & { readonly available: boolean };

/** Another event's fixture already in the slot: fixed, never moved. */
export type EngineCommitment = {
  readonly event: EngineId;
  readonly fixture: EngineId;
  readonly people: readonly EngineId[];
};

/** A time slot with one or more events, or one tab round of a windowed stage. */
export type EngineDrawInput =
  | {
      readonly call: 'slot';
      readonly slot: EngineId;
      readonly events: readonly EngineEventRequest[];
      readonly judges: readonly EngineSlotJudge[] | null;
      readonly commitments: readonly EngineCommitment[];
      readonly seed: Uint8Array;
    }
  | {
      readonly call: 'windowed';
      readonly event: EngineEventRequest;
      readonly judges: readonly EngineJudge[] | null;
      readonly seed: Uint8Array;
    };

export type EngineFixtureRef =
  | { readonly kind: 'existing'; readonly id: EngineId }
  | { readonly kind: 'new'; readonly ordinal: number };

export type EngineRuleBreak = {
  readonly event: EngineId;
  /** A force key of the settings catalogue. */
  readonly key: string;
  readonly fixture: EngineFixtureRef;
};

/** A structural fact no override covers, by its name. */
export type EngineInvalidFact = { readonly fact: string };

export type EngineAssessment = {
  readonly warnings: readonly EngineRuleBreak[];
  readonly broken: readonly EngineRuleBreak[];
  readonly invalid: readonly EngineInvalidFact[];
};

/** What a draw was computed from; stored with the draw as its `inputs`. */
export type EngineInputsRecord = {
  readonly engine: Readonly<Record<string, string>>;
  readonly settingsDigest: string;
  readonly seed: string;
  /** Results counted through this tab round. */
  readonly cutoff: number;
  readonly results: readonly EngineId[];
} & Readonly<Record<string, unknown>>;

/** One event's plan for its tab round: keep, add and withdraw. */
export type EngineDraw = {
  readonly event: EngineId;
  readonly keep: readonly {
    readonly id: EngineId;
    readonly fixture: EngineFixture;
  }[];
  readonly add: readonly {
    readonly ordinal: number;
    readonly fixture: EngineFixture;
  }[];
  readonly withdraw: readonly EngineId[];
  readonly assessment: EngineAssessment;
  readonly inputs: EngineInputsRecord;
};

/** A plan as a person may hand it back: the three lists, without costs. */
export type EnginePlan = Pick<
  EngineDraw,
  'event' | 'keep' | 'add' | 'withdraw'
>;

export type EngineDrawAnswer =
  | { readonly kind: 'drawn'; readonly draws: readonly EngineDraw[] }
  | { readonly kind: 'infeasible'; readonly cause: 'slot' }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'rules';
      readonly event: EngineId;
    }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'panels';
      readonly draws: readonly EngineDraw[];
    }
  | {
      readonly kind: 'infeasible';
      readonly cause: 'structure';
      readonly event: EngineId;
      readonly fact: 'missing_result' | 'no_plan';
    }
  | {
      readonly kind: 'unresolved';
      readonly event: EngineId;
      readonly attempt: EngineDraw;
      readonly broken: readonly EngineRuleBreak[];
    };

/** The engine, as the draw commands call it: pure functions of plain data. */
export type TabEngine = {
  readonly draw: (input: EngineDrawInput) => EngineDrawAnswer;
  readonly assess: (
    input: EngineDrawInput,
    plans: readonly EnginePlan[],
  ) => readonly EngineAssessment[];
};
