import type {
  DrawInput,
  EventRequest,
  ExistingFixture,
  Fixture,
  FormatDescriptor,
  Plan,
  RatingSnapshot,
  StageHistory,
  DrawAnswer,
  Assessment,
} from '@daisy/tab-engine';

export type {
  Assessment as EngineAssessment,
  Commitment as EngineCommitment,
  Draw as EngineDraw,
  DrawAnswer as EngineDrawAnswer,
  Entry as EngineEntry,
  FixtureRef as EngineFixtureRef,
  FormatDescriptor as EngineFormat,
  InputsRecord as EngineInputsRecord,
  ResolvedSettings as EngineResolvedSettings,
  SlotJudge as EngineSlotJudge,
  Stage as EngineStage,
} from '@daisy/tab-engine';

export type EngineStageHistory = StageHistory<FormatDescriptor>;
export type EngineRatings = RatingSnapshot | null;

/**
 * Persisted rows and typed edits have not yet proved their format's pairing
 * arity. Only this boundary widens the canonical tuple; the adapter validates
 * it before calling the engine.
 */
export type EngineFixture =
  | Exclude<Fixture, { kind: 'pairing' }>
  | (Omit<Extract<Fixture, { kind: 'pairing' }>, 'sides'> & {
      readonly sides: readonly string[];
    });
export type EngineExistingFixture = Omit<
  ExistingFixture<FormatDescriptor>,
  'fixture'
> & { readonly fixture: EngineFixture };
export type EngineEventRequest = Omit<EventRequest, 'history' | 'existing'> & {
  readonly history: EngineStageHistory;
  readonly existing: readonly EngineExistingFixture[];
};
export type EngineDrawInput =
  | (Omit<Extract<DrawInput, { call: 'slot' }>, 'events'> & {
      readonly events: readonly EngineEventRequest[];
    })
  | (Omit<Extract<DrawInput, { call: 'windowed' }>, 'event'> & {
      readonly event: EngineEventRequest;
    });
export type EnginePlan = Omit<Plan, 'keep' | 'add'> & {
  readonly keep: readonly (Omit<Plan['keep'][number], 'fixture'> & {
    readonly fixture: EngineFixture;
  })[];
  readonly add: readonly (Omit<Plan['add'][number], 'fixture'> & {
    readonly fixture: EngineFixture;
  })[];
};

/** Only unvalidated inputs differ from the canonical engine interface. */
export type TabEngine = {
  readonly draw: (input: EngineDrawInput) => DrawAnswer;
  readonly assess: (
    input: EngineDrawInput,
    plans: readonly EnginePlan[],
  ) => readonly Assessment[];
};
