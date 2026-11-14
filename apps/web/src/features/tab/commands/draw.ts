import type {
  audiences,
  drawMethods,
  drawStatuses,
  fixtureKinds,
  fixtureStatuses,
  releaseThings,
} from '@daisy/protocol/lobby';
import type {
  CommandFinding,
  FixtureChange,
  SharedLobbyRefusal,
} from '@daisy/protocol/lobby/command';
import type {
  DrawCommand,
  DrawEdit,
  DrawOverride,
  DrawRefusal,
} from '@daisy/protocol/lobby/draw-command';
import { fixtureChangesOf, type PublishedVersion } from './fixture-changes';
import { officiatingRefusal, type FixtureState } from './fixture';
import { refuse, type CommandDecision } from './run-command';
import type {
  EngineAssessment,
  EngineCommitment,
  EngineDraw,
  EngineDrawInput,
  EngineEntry,
  EngineEventRequest,
  EngineExistingFixture,
  EngineFixture,
  EngineFixtureRef,
  EngineFormat,
  EngineInputsRecord,
  EngineRatings,
  EngineResolvedSettings,
  EngineSlotJudge,
  EngineStage,
  EngineStageHistory,
  TabEngine,
} from './tab-engine';

type DrawStatus = (typeof drawStatuses)[number];
type DrawMethod = (typeof drawMethods)[number];
type FixtureKind = (typeof fixtureKinds)[number];
type FixtureStatus = (typeof fixtureStatuses)[number];

/**
 * Where a published fixture's Room is, in the state table's terms. What a
 * draw may do to a fixture follows from it: only one whose Round has not
 * started may be re-paired, withdrawn or left out of a new version.
 */
export type LiveFixtureState =
  'not_open' | 'open' | 'round_live' | 'ballot_in' | 'has_result';

/** A live Round, a ballot or a result fixes a fixture's pairing. */
export const isRepairable = (state: LiveFixtureState): boolean => {
  switch (state) {
    case 'not_open':
    case 'open':
      return true;
    case 'round_live':
    case 'ballot_in':
    case 'has_result':
      return false;
  }
};

/**
 * A draw fixture's row of the state table, as the officiating commands read
 * it (`officiatingRefusal` in fixture.ts), so a draw-level judge assignment
 * follows the same table as a fixture-level one.
 */
const fixtureStateOfDraw = (fixture: DrawFixtureFacts): FixtureState => {
  switch (fixture.status) {
    case 'draft':
      return 'draft';
    case 'withdrawn':
      return 'withdrawn';
    case 'published':
      switch (fixture.state) {
        case null:
        case 'not_open':
        case 'open':
          return 'not_started';
        case 'round_live':
          return 'round_started';
        case 'ballot_in':
          return 'ballot_in';
        case 'has_result':
          return 'has_result';
      }
  }
};

/** What a draw version records in its `inputs` beside the engine's record. */
type DrawInputs = {
  /** The engine's inputs record; null for a typed draw never computed. */
  readonly engine: EngineInputsRecord | null;
  /** The digest of the event's resolved settings the version was made under. */
  readonly settingsDigest: string;
  /** The `rule` keys the version breaks; each needs an override to publish. */
  readonly broken: readonly string[];
  /** The rules the host overrode at publish, with the reason. */
  readonly overrides: readonly DrawOverride[];
};

/** A `draws` row of the tab round, with the fixtures it holds. */
export type DrawVersionFacts = {
  readonly id: string;
  readonly version: number;
  readonly status: DrawStatus;
  readonly basedOnDrawId: string | null;
  readonly inputs: DrawInputs;
  readonly fixtureIds: readonly string[];
};

/** A `fixtures` row any version of the tab round holds, with its entries and panel. */
export type DrawFixtureFacts = {
  readonly id: string;
  readonly kind: FixtureKind;
  readonly status: FixtureStatus;
  /** The fixture's own version, which officiating moves; a draw never does. */
  readonly version: number;
  readonly roomId: string | null;
  /** Null unless published. */
  readonly state: LiveFixtureState | null;
  readonly entries: readonly {
    readonly entryId: string;
    readonly position: number;
    readonly side: string | null;
    /** The entry's members, as accounts. */
    readonly members: readonly string[];
  }[];
  readonly judges: readonly {
    readonly tournamentJudgeId: string;
    /** The judge, as an account. */
    readonly person: string;
    readonly chair: boolean;
  }[];
};

/**
 * What a draw command is decided from: the event and tab round, every
 * version of the tab round's draw and every fixture they hold, the event's
 * settings resolved now, the engine's inputs as loaded, and the slot.
 * `freshIds` are ids minted at the edge, used in order; the store gives at
 * least one per entry of the event plus one per release, and two more. A
 * command needing more than it gives is refused `fresh-ids-short`.
 */
export type DrawFacts = {
  readonly commandId: string;
  readonly now: string;
  readonly freshIds: readonly string[];
  readonly event: {
    readonly id: string;
    readonly lobbyId: string;
    readonly name: string;
    readonly formatId: string;
    readonly formatVersion: number;
    readonly templateId: string | null;
    readonly ballotDefinitionId: string | null;
    readonly ballotDefinitionVersion: number | null;
    readonly format: EngineFormat;
    /** The format's side names in side order; null where it has none. */
    readonly sideNames: readonly string[] | null;
  };
  readonly tabRound: {
    readonly id: string;
    readonly number: number;
    readonly name: string | null;
    readonly stage: EngineStage;
    readonly timing: 'live' | 'windowed';
    readonly timeSlot: { readonly id: string; readonly version: number } | null;
  };
  readonly versions: readonly DrawVersionFacts[];
  readonly fixtures: readonly DrawFixtureFacts[];
  readonly settings:
    | {
        readonly kind: 'resolved';
        readonly values: EngineResolvedSettings;
        readonly digest: string;
      }
    | { readonly kind: 'incomplete' };
  readonly engine: {
    readonly entries: readonly EngineEntry[];
    readonly history: EngineStageHistory;
    readonly ratings: EngineRatings;
    readonly judges: readonly EngineSlotJudge[];
    readonly commitments: readonly EngineCommitment[];
  };
  /** An entry made two breaks and has not chosen, under `break.double_qualifier`. */
  readonly breakChoicesPending: boolean;
  /** People seated in other events' live fixtures in the same slot. */
  readonly slotElsewhere: readonly string[];
  /** The releases the event's audience settings open at publish. */
  readonly releasesAtOnce: readonly {
    readonly thing: (typeof releaseThings)[number];
    readonly audience: (typeof audiences)[number];
  }[];
};

type DrawChild = {
  readonly tabRoundId: string;
  readonly eventId: string;
  readonly lobbyId: string;
};
type FixtureChild = DrawChild & {
  readonly fixtureId: string;
  readonly fixtureStatus: FixtureStatus;
};

/** The rows a draw command writes, on the merged tables' columns. */
type DrawWrite =
  | {
      readonly table: 'draws';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly id: string;
        readonly version: number;
        readonly status: 'draft';
        readonly basedOnDrawId: string | null;
        readonly method: DrawMethod;
        readonly engineVersion: string | null;
        readonly inputs: DrawInputs;
      };
    }
  | {
      readonly table: 'draws';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: {
        readonly status: 'published';
        readonly publishedAt: string;
        readonly inputs: DrawInputs;
      };
    }
  | {
      readonly table: 'draws';
      readonly op: 'delete';
      readonly where: { readonly id: string };
    }
  | {
      readonly table: 'draw_fixtures';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly drawId: string;
        readonly fixtureId: string;
      };
    }
  | {
      readonly table: 'draw_result_inputs';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly drawId: string;
        readonly resultId: string;
      };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'insert';
      readonly row: Omit<DrawChild, 'tabRoundId'> & {
        readonly id: string;
        readonly tabRoundId: string;
        readonly kind: FixtureKind;
        readonly status: 'draft';
      };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set:
        | {
            readonly status: 'published';
            readonly publishedAt: string;
            readonly roomId: string | null;
          }
        | { readonly status: 'withdrawn'; readonly withdrawnAt: string }
        /** Officiating a live fixture moves its own version, as one judge command does. */
        | { readonly version: number };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'delete';
      readonly where: { readonly id: string };
    }
  | {
      readonly table: 'fixture_entries';
      readonly op: 'insert';
      readonly row: FixtureChild & {
        readonly entryId: string;
        readonly position: number;
        readonly side: string | null;
      };
    }
  | {
      readonly table: 'fixture_entries' | 'fixture_judges';
      readonly op: 'delete';
      readonly where: { readonly fixtureId: string };
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'insert';
      readonly row: FixtureChild & {
        readonly tournamentJudgeId: string;
        readonly chair: boolean;
      };
    }
  | {
      /**
       * An event Room for a newly published fixture. The rest of a Room's
       * columns (config, rules snapshot, execution plan) are the Room
       * factory's, made by the store from the pinned settings.
       */
      readonly table: 'rooms';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly lobbyId: string;
        readonly lobbyKind: 'tournament';
        readonly title: string;
        readonly status: 'assembling';
        readonly formatId: string;
        readonly formatVersion: number;
        readonly templateId: string | null;
        readonly ballotDefinitionId: string | null;
        readonly ballotDefinitionVersion: number | null;
      };
    }
  | {
      readonly table: 'rooms';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: { readonly status: 'closed' };
    }
  | {
      /** A seat in the new Room; its role and slot are the Room factory's. */
      readonly table: 'room_participants';
      readonly op: 'insert';
      readonly row: { readonly roomId: string; readonly actorId: string };
    }
  | {
      readonly table: 'releases';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly id: string;
        readonly thing: (typeof releaseThings)[number];
        readonly audience: (typeof audiences)[number];
        readonly cause: 'at_once';
        readonly commandId: string;
        readonly openedAt: string;
      };
    }
  | {
      readonly table: 'time_slots';
      readonly op: 'update';
      readonly where: { readonly id: string; readonly version: number };
      readonly set: { readonly version: number };
    };

export type DrawDecision = CommandDecision<
  DrawRefusal | SharedLobbyRefusal,
  DrawWrite
>;

const child = (facts: DrawFacts): DrawChild => ({
  tabRoundId: facts.tabRound.id,
  eventId: facts.event.id,
  lobbyId: facts.event.lobbyId,
});

/** The first `count` fresh ids, or null when the store gave too few. */
const freshIdsFor = (
  facts: DrawFacts,
  count: number,
): readonly string[] | null =>
  facts.freshIds.length < count ? null : facts.freshIds.slice(0, count);

const latest = (versions: readonly DrawVersionFacts[]) =>
  versions.reduce<DrawVersionFacts | null>(
    (best, version) =>
      best === null || version.version > best.version ? version : best,
    null,
  );
const latestPublished = (versions: readonly DrawVersionFacts[]) =>
  latest(versions.filter((version) => version.status === 'published'));

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return (
    left.size === right.size && new Set([...left, ...right]).size === left.size
  );
};

const fixtureById = (facts: DrawFacts) =>
  new Map(facts.fixtures.map((fixture) => [fixture.id, fixture]));

const entriesOf = (fixture: EngineFixture): readonly string[] => {
  switch (fixture.kind) {
    case 'bye':
      return [fixture.entry];
    case 'pairing':
      return fixture.sides;
    case 'section':
      return fixture.speakers;
  }
};
const panelOf = (fixture: EngineFixture): readonly string[] =>
  fixture.kind === 'bye' ? [] : fixture.panel;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Same kind, same entries in the same order, same panel in seat order. */
const sameFixture = (a: EngineFixture, b: EngineFixture) =>
  a.kind === b.kind &&
  sameList(entriesOf(a), entriesOf(b)) &&
  sameList(panelOf(a), panelOf(b));

/** The engine's view of a stored fixture: entries in position order, chair first. */
const engineFixtureOf = (fixture: DrawFixtureFacts): EngineFixture => {
  const entries = [...fixture.entries]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.entryId);
  const panel = [...fixture.judges]
    .sort((a, b) => Number(b.chair) - Number(a.chair))
    .map((judge) => judge.tournamentJudgeId);
  switch (fixture.kind) {
    case 'bye':
      return { kind: 'bye', entry: entries[0] ?? '' };
    case 'pairing':
      return { kind: 'pairing', sides: entries, panel };
    case 'section':
      return { kind: 'section', speakers: entries, panel };
  }
};

/** A fixture of a format: speakers make a section, sides a pairing, one entry a bye. */
const fixtureFor = (
  format: EngineFormat,
  entries: readonly string[],
  panel: readonly string[],
): EngineFixture =>
  entries.length === 1
    ? { kind: 'bye', entry: entries[0]! }
    : 'of' in format && format.of === 'speakers'
      ? { kind: 'section', speakers: entries, panel }
      : { kind: 'pairing', sides: entries, panel };

const request = (
  facts: DrawFacts,
  settings: EngineResolvedSettings,
  cutoff: number,
  existing: readonly EngineExistingFixture[],
): EngineEventRequest => ({
  event: facts.event.id,
  format: facts.event.format,
  stage: facts.tabRound.stage,
  tabRound: facts.tabRound.number,
  entries: facts.engine.entries,
  history: facts.engine.history,
  settings,
  cutoff,
  ratings: facts.engine.ratings,
  existing,
});

const seedBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const drawInput = (
  facts: DrawFacts,
  event: EngineEventRequest,
  seated: boolean,
  seed: Uint8Array,
): EngineDrawInput => {
  const judges = seated ? facts.engine.judges : null;
  const slot = facts.tabRound.timeSlot;
  return facts.tabRound.timing === 'live' && slot !== null
    ? {
        call: 'slot',
        slot: slot.id,
        events: [event],
        judges,
        commitments: facts.engine.commitments,
        seed,
      }
    : { call: 'windowed', event, judges, seed };
};

/** The live fixtures go in as fixed when they cannot be re-paired, movable otherwise. */
const liveExisting = (facts: DrawFacts): EngineExistingFixture[] =>
  facts.fixtures
    .filter((fixture) => fixture.status === 'published')
    .map((fixture) => ({
      id: fixture.id,
      fixture: engineFixtureOf(fixture),
      hold:
        fixture.state !== null && !isRepairable(fixture.state)
          ? 'fixed'
          : 'movable',
    }));

const refText = (ref: EngineFixtureRef) =>
  ref.kind === 'existing' ? ref.id : `new:${ref.ordinal}`;

/** Each broken rule, preference and warning the engine found, as a finding. */
const findingsOf = (assessment: EngineAssessment): CommandFinding[] => [
  ...assessment.broken.map((rule) => ({
    kind: 'rule' as const,
    key: rule.key,
    detail: refText(rule.fixture),
  })),
  ...assessment.warnings.map((rule) => ({
    kind: 'warning' as const,
    key: rule.key,
    detail: refText(rule.fixture),
  })),
  ...assessment.invalid.map((fact) => ({
    kind: 'warning' as const,
    key: `invalid.${fact.fact}`,
    detail: JSON.stringify(fact),
  })),
];

/** A fixture a new draft holds: kept by id, or new with its entries and panel. */
type DraftFixture =
  | { readonly kind: 'kept'; readonly id: string }
  | { readonly kind: 'new'; readonly fixture: EngineFixture };

/**
 * The writes of a new draft version holding these fixtures: one fresh id for
 * the version and one per new fixture, or null when the facts give too few.
 */
const draftWrites = (
  facts: DrawFacts,
  draft: {
    readonly method: DrawMethod;
    readonly engineVersion: string | null;
    readonly basedOnDrawId: string | null;
    readonly inputs: DrawInputs;
    readonly fixtures: readonly DraftFixture[];
    readonly resultIds: readonly string[];
  },
): {
  readonly drawId: string;
  readonly version: number;
  readonly writes: DrawWrite[];
} | null => {
  const added = draft.fixtures.filter((fixture) => fixture.kind === 'new');
  const ids = freshIdsFor(facts, 1 + added.length);
  if (ids === null) return null;
  const drawId = ids[0]!;
  const version = (latest(facts.versions)?.version ?? 0) + 1;
  const base = child(facts);
  const placed = draft.fixtures.map((fixture) =>
    fixture.kind === 'kept'
      ? { id: fixture.id, fixture: null }
      : { id: ids[1 + added.indexOf(fixture)]!, fixture: fixture.fixture },
  );
  const fixtureRows = placed.flatMap(({ id, fixture }): DrawWrite[] => {
    if (fixture === null) return [];
    const row = { ...base, fixtureId: id, fixtureStatus: 'draft' as const };
    return [
      {
        table: 'fixtures',
        op: 'insert',
        row: { ...base, id, kind: fixture.kind, status: 'draft' },
      },
      ...entriesOf(fixture).map((entryId, position): DrawWrite => ({
        table: 'fixture_entries',
        op: 'insert',
        row: {
          ...row,
          entryId,
          position,
          side:
            fixture.kind === 'pairing'
              ? (facts.event.sideNames?.[position] ?? null)
              : null,
        },
      })),
      ...panelOf(fixture).map((tournamentJudgeId, seat): DrawWrite => ({
        table: 'fixture_judges',
        op: 'insert',
        row: { ...row, tournamentJudgeId, chair: seat === 0 },
      })),
    ];
  });
  return {
    drawId,
    version,
    writes: [
      {
        table: 'draws',
        op: 'insert',
        row: {
          ...base,
          id: drawId,
          version,
          status: 'draft',
          basedOnDrawId: draft.basedOnDrawId,
          method: draft.method,
          engineVersion: draft.engineVersion,
          inputs: draft.inputs,
        },
      },
      ...fixtureRows,
      ...placed.map(({ id }): DrawWrite => ({
        table: 'draw_fixtures',
        op: 'insert',
        row: { ...base, drawId, fixtureId: id },
      })),
      ...draft.resultIds.map((resultId): DrawWrite => ({
        table: 'draw_result_inputs',
        op: 'insert',
        row: { ...base, drawId, resultId },
      })),
    ],
  };
};

const engineVersionOf = (inputs: EngineInputsRecord) =>
  Object.entries(inputs.engine)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([part, version]) => `${part}@${version}`)
    .join(' ');

const onDraw = (
  drawId: string,
  version: number,
  writes: readonly DrawWrite[],
  findings: readonly CommandFinding[] = [],
  fixtureChanges: readonly FixtureChange[] = [],
): DrawDecision => ({
  kind: 'accepted',
  aggregate: { kind: 'draw', id: drawId },
  resultingVersion: version,
  writes,
  findings,
  fixtureChanges,
});

const generateDraw = (
  engine: TabEngine,
  facts: DrawFacts,
  command: Extract<DrawCommand, { type: 'generate-draw' }>,
): DrawDecision => {
  if (command.tabRoundId !== facts.tabRound.id) return refuse('not-found');
  if (facts.settings.kind === 'incomplete')
    return refuse('settings-incomplete');
  if (facts.breakChoicesPending) return refuse('choices-pending');
  const settings = facts.settings;
  const answer = engine.draw(
    drawInput(
      facts,
      request(
        facts,
        settings.values,
        command.resultCutoff,
        liveExisting(facts),
      ),
      false,
      seedBytes(command.seed),
    ),
  );
  switch (answer.kind) {
    case 'infeasible':
      return answer.cause === 'structure' && answer.fact === 'missing_result'
        ? refuse('results-incomplete')
        : refuse('rule-unsatisfiable');
    case 'unresolved':
      return refuse('draw-unresolved');
    case 'drawn':
      break;
  }
  const drawn: EngineDraw | undefined = answer.draws.find(
    (candidate) => candidate.event === facts.event.id,
  );
  if (drawn === undefined) return refuse('draw-unresolved');
  const fixtures: DraftFixture[] = [
    ...drawn.keep.map((kept) => ({ kind: 'kept' as const, id: kept.id })),
    ...drawn.add.map((added) => ({
      kind: 'new' as const,
      fixture: added.fixture,
    })),
  ];
  const keptIds = drawn.keep.map((kept) => kept.id);
  const holds = (version: DrawVersionFacts | null) =>
    version !== null && sameSet(version.fixtureIds, keptIds);
  if (
    drawn.add.length === 0 &&
    (holds(latest(facts.versions)) || holds(latestPublished(facts.versions)))
  )
    return refuse('draw-unchanged');
  const draft = draftWrites(facts, {
    method: 'computed',
    engineVersion: engineVersionOf(drawn.inputs),
    basedOnDrawId: latestPublished(facts.versions)?.id ?? null,
    inputs: {
      engine: drawn.inputs,
      settingsDigest: settings.digest,
      broken: drawn.assessment.broken.map((rule) => rule.key),
      overrides: [],
    },
    fixtures,
    resultIds: drawn.inputs.results,
  });
  if (draft === null) return refuse('fresh-ids-short');
  return onDraw(
    draft.drawId,
    draft.version,
    draft.writes,
    findingsOf(drawn.assessment),
  );
};

const slotBump = (facts: DrawFacts): DrawWrite[] => {
  const slot = facts.tabRound.timeSlot;
  return facts.tabRound.timing === 'live' && slot !== null
    ? [
        {
          table: 'time_slots',
          op: 'update',
          where: { id: slot.id, version: slot.version },
          set: { version: slot.version + 1 },
        },
      ]
    : [];
};

const peopleOf = (fixture: DrawFixtureFacts): string[] =>
  fixture.kind === 'bye'
    ? []
    : [
        ...fixture.entries.flatMap((entry) => entry.members),
        ...fixture.judges.map((judge) => judge.person),
      ];

const assignJudges = (
  engine: TabEngine,
  facts: DrawFacts,
  command: Extract<DrawCommand, { type: 'assign-judges' }>,
): DrawDecision => {
  const draw = facts.versions.find((version) => version.id === command.drawId);
  if (draw === undefined) return refuse('not-found');
  if (draw.id !== latest(facts.versions)?.id) return refuse('draw-superseded');
  if (facts.settings.kind === 'incomplete')
    return refuse('settings-incomplete');
  const byId = fixtureById(facts);
  const held = draw.fixtureIds.flatMap((id) => byId.get(id) ?? []);
  /**
   * The fixtures this command may seat judges on: those the state table lets
   * a judge join; on a draft, only its own unpublished fixtures, since a live
   * fixture's panel changes only by officiating on the published version.
   */
  const seatable = new Set(
    held
      .filter(
        (fixture) =>
          (draw.status === 'published' || fixture.status === 'draft') &&
          officiatingRefusal(
            fixtureStateOfDraw(fixture),
            fixture.kind,
            'any',
          ) === null,
      )
      .map((fixture) => fixture.id),
  );
  // Every held fixture goes in fixed: the engine keeps a fixed fixture's
  // entries and seated judges and fills its empty seats up to the panel size.
  const answer = engine.draw(
    drawInput(
      facts,
      request(
        facts,
        facts.settings.values,
        draw.inputs.engine?.cutoff ?? 0,
        held.map((fixture) => ({
          id: fixture.id,
          fixture: engineFixtureOf(fixture),
          hold: 'fixed',
        })),
      ),
      true,
      seedBytes(draw.inputs.engine?.seed ?? ''),
    ),
  );
  if (answer.kind === 'infeasible' && answer.cause === 'slot')
    return refuse('judge-double-booked');
  if (answer.kind !== 'drawn') return refuse('judges-insufficient');
  const drawn = answer.draws.find(
    (candidate) => candidate.event === facts.event.id,
  );
  if (drawn === undefined) return refuse('judges-insufficient');
  if (
    drawn.assessment.invalid.some(
      (fact) =>
        fact.fact === 'judge_twice' || fact.fact === 'person_twice_in_slot',
    )
  )
    return refuse('judge-double-booked');
  const persons = new Map(
    facts.engine.judges.map((judge) => [judge.id, judge.person]),
  );
  const seatings = drawn.keep.flatMap((kept) => {
    const stored = seatable.has(kept.id) ? byId.get(kept.id) : undefined;
    if (stored === undefined) return [];
    const seated = new Set(
      stored.judges.map((judge) => judge.tournamentJudgeId),
    );
    const added = panelOf(kept.fixture)
      .filter((judgeId) => !seated.has(judgeId))
      .map((judgeId) => ({ judgeId }));
    return added.length === 0 ? [] : [{ stored, added }];
  });
  const base = child(facts);
  // A panel with no chair takes its first added judge as chair.
  const writes = seatings.flatMap(({ stored, added }) =>
    added.map(({ judgeId }, index): DrawWrite => ({
      table: 'fixture_judges',
      op: 'insert',
      row: {
        ...base,
        fixtureId: stored.id,
        fixtureStatus: stored.status,
        tournamentJudgeId: judgeId,
        chair: index === 0 && !stored.judges.some((judge) => judge.chair),
      },
    })),
  );
  const officiated = seatings.filter(
    ({ stored }) => stored.status === 'published',
  );
  // A live fixture's panel changed: it moves its own version, as the
  // fixture-level judge commands do, and the slot moves once.
  const bumped = officiated.map(({ stored }): DrawWrite => ({
    table: 'fixtures',
    op: 'update',
    where: { id: stored.id },
    set: { version: stored.version + 1 },
  }));
  return onDraw(
    draw.id,
    draw.version,
    officiated.length === 0
      ? writes
      : [...writes, ...bumped, ...slotBump(facts)],
    findingsOf(drawn.assessment),
    officiated.map(({ stored, added }) => ({
      kind: 'officiated',
      fixtureId: stored.id,
      tabRoundId: facts.tabRound.id,
      commandId: facts.commandId,
      type: command.type,
      people: [
        ...new Set([
          ...peopleOf(stored),
          ...added.flatMap(({ judgeId }) => persons.get(judgeId) ?? []),
        ]),
      ].sort(),
    })),
  );
};

/** A fixture being edited: its stored id until an edit changes it. */
type Working = {
  readonly key: string;
  readonly keptId: string | null;
  readonly fixture: EngineFixture;
};

type EditOutcome =
  | {
      readonly kind: 'refused';
      readonly refusal: 'fixture-started' | 'not-found';
    }
  | { readonly kind: 'edited'; readonly fixtures: readonly Working[] };

const applyEdits = (
  facts: DrawFacts,
  start: readonly Working[],
  edits: readonly DrawEdit[],
): EditOutcome => {
  const byId = fixtureById(facts);
  const fixed = (item: Working) => {
    const stored = item.keptId === null ? undefined : byId.get(item.keptId);
    return stored?.state != null && !isRepairable(stored.state);
  };
  let working = [...start];
  let added = 0;
  const holding = (entryId: string) =>
    working.find((item) => entriesOf(item.fixture).includes(entryId));
  const take = (entryId: string): EditOutcome | null => {
    const source = holding(entryId);
    if (source === undefined) return null;
    if (fixed(source)) return { kind: 'refused', refusal: 'fixture-started' };
    const rest = entriesOf(source.fixture).filter((id) => id !== entryId);
    working = working.flatMap((item) =>
      item !== source
        ? [item]
        : rest.length === 0
          ? []
          : [
              {
                key: item.key,
                keptId: null,
                fixture: fixtureFor(
                  facts.event.format,
                  rest,
                  panelOf(item.fixture),
                ),
              },
            ],
    );
    return null;
  };
  for (const edit of edits) {
    switch (edit.type) {
      case 'move-entry': {
        if (holding(edit.entryId) === undefined)
          return { kind: 'refused', refusal: 'not-found' };
        const refused = take(edit.entryId);
        if (refused !== null) return refused;
        const target = working.find((item) => item.key === edit.toFixtureId);
        if (target === undefined)
          return { kind: 'refused', refusal: 'not-found' };
        if (fixed(target))
          return { kind: 'refused', refusal: 'fixture-started' };
        const entries = [...entriesOf(target.fixture)];
        entries.splice(
          Math.min(edit.position, entries.length),
          0,
          edit.entryId,
        );
        working = working.map((item) =>
          item !== target
            ? item
            : {
                key: item.key,
                keptId: null,
                fixture: fixtureFor(
                  facts.event.format,
                  entries,
                  panelOf(item.fixture),
                ),
              },
        );
        break;
      }
      case 'swap-sides': {
        const target = working.find((item) => item.key === edit.fixtureId);
        if (target === undefined || target.fixture.kind !== 'pairing')
          return { kind: 'refused', refusal: 'not-found' };
        if (fixed(target))
          return { kind: 'refused', refusal: 'fixture-started' };
        const swapped = {
          ...target.fixture,
          sides: [...target.fixture.sides].reverse(),
        };
        working = working.map((item) =>
          item !== target
            ? item
            : { key: item.key, keptId: null, fixture: swapped },
        );
        break;
      }
      case 'remove-fixture': {
        const target = working.find((item) => item.key === edit.fixtureId);
        if (target === undefined)
          return { kind: 'refused', refusal: 'not-found' };
        if (fixed(target))
          return { kind: 'refused', refusal: 'fixture-started' };
        working = working.filter((item) => item !== target);
        break;
      }
      case 'add-fixture':
      case 'set-bye': {
        const entryIds =
          edit.type === 'set-bye' ? [edit.entryId] : edit.entryIds;
        for (const entryId of entryIds) {
          const refused = take(entryId);
          if (refused !== null) return refused;
        }
        working = [
          ...working,
          {
            key: `new:${added++}`,
            keptId: null,
            fixture:
              edit.type === 'set-bye'
                ? { kind: 'bye', entry: edit.entryId }
                : edit.kind === 'section'
                  ? { kind: 'section', speakers: entryIds, panel: [] }
                  : { kind: 'pairing', sides: entryIds, panel: [] },
          },
        ];
        break;
      }
    }
  }
  return { kind: 'edited', fixtures: working };
};

const editDraw = (
  engine: TabEngine,
  facts: DrawFacts,
  command: Extract<DrawCommand, { type: 'edit-draw' }>,
): DrawDecision => {
  const based = facts.versions.find(
    (version) => version.id === command.basedOnDrawId,
  );
  if (based === undefined) return refuse('not-found');
  if (based.version !== latest(facts.versions)?.version)
    return refuse('stale-draft');
  const byId = fixtureById(facts);
  const start = based.fixtureIds.flatMap((id): Working[] => {
    const stored = byId.get(id);
    return stored === undefined
      ? []
      : [{ key: id, keptId: id, fixture: engineFixtureOf(stored) }];
  });
  const applied = applyEdits(facts, start, command.edits);
  if (applied.kind === 'refused') return refuse(applied.refusal);
  // An edit that restores a stored fixture's content keeps that fixture.
  const edited = {
    fixtures: applied.fixtures.map((item): Working => {
      const stored = start.find((origin) => origin.key === item.key);
      return item.keptId === null &&
        stored !== undefined &&
        sameFixture(item.fixture, stored.fixture)
        ? { ...item, keptId: stored.key }
        : item;
    }),
  };
  const keptIds = edited.fixtures.flatMap((item) =>
    item.keptId === null ? [] : [item.keptId],
  );
  if (
    keptIds.length === edited.fixtures.length &&
    sameSet(keptIds, based.fixtureIds)
  )
    return refuse('draw-unchanged');
  const live = new Set(
    facts.fixtures
      .filter((fixture) => fixture.status === 'published')
      .map((f) => f.id),
  );
  const fresh = edited.fixtures.filter(
    (item) => item.keptId === null || !live.has(item.keptId),
  );
  const assessment =
    facts.settings.kind === 'resolved'
      ? engine.assess(
          drawInput(
            facts,
            request(facts, facts.settings.values, 0, liveExisting(facts)),
            true,
            seedBytes(based.inputs.engine?.seed ?? ''),
          ),
          [
            {
              event: facts.event.id,
              keep: edited.fixtures.flatMap((item) =>
                item.keptId !== null && live.has(item.keptId)
                  ? [{ id: item.keptId, fixture: item.fixture }]
                  : [],
              ),
              add: fresh.map((item, ordinal) => ({
                ordinal,
                fixture: item.fixture,
              })),
              withdraw: [...live].filter((id) => !keptIds.includes(id)),
            },
          ],
        )[0]
      : undefined;
  const draft = draftWrites(facts, {
    method: 'typed',
    engineVersion: null,
    basedOnDrawId:
      based.status === 'published' ? based.id : based.basedOnDrawId,
    inputs: {
      ...based.inputs,
      broken: assessment?.broken.map((rule) => rule.key) ?? based.inputs.broken,
    },
    fixtures: edited.fixtures.map((item) =>
      item.keptId === null
        ? { kind: 'new', fixture: item.fixture }
        : { kind: 'kept', id: item.keptId },
    ),
    resultIds: based.inputs.engine?.results ?? [],
  });
  if (draft === null) return refuse('fresh-ids-short');
  return onDraw(
    draft.drawId,
    draft.version,
    draft.writes,
    assessment === undefined ? [] : findingsOf(assessment),
  );
};

const seated = (
  version: DrawVersionFacts,
  byId: ReadonlyMap<string, DrawFixtureFacts>,
): PublishedVersion['fixtures'] =>
  version.fixtureIds.flatMap((id) => {
    const fixture = byId.get(id);
    return fixture === undefined
      ? []
      : [{ fixtureId: id, people: peopleOf(fixture) }];
  });

const doubleBooked = (
  held: readonly DrawFixtureFacts[],
  elsewhere: ReadonlySet<string>,
): { readonly judges: boolean; readonly entries: boolean } => {
  const judges = held.flatMap((fixture) => fixture.judges);
  const judgeIds = judges.map((judge) => judge.tournamentJudgeId);
  const members = held
    .filter((fixture) => fixture.kind !== 'bye')
    .flatMap((fixture) => fixture.entries.flatMap((entry) => entry.members));
  return {
    judges:
      new Set(judgeIds).size !== judgeIds.length ||
      judges.some((judge) => elsewhere.has(judge.person)),
    entries:
      new Set(members).size !== members.length ||
      members.some((person) => elsewhere.has(person)),
  };
};

const roomTitle = (facts: DrawFacts) =>
  `${facts.event.name}: ${facts.tabRound.name ?? `Round ${facts.tabRound.number}`}`;

const publishDraw = (
  facts: DrawFacts,
  command: Extract<DrawCommand, { type: 'publish-draw' }>,
): DrawDecision => {
  const draw = facts.versions.find((version) => version.id === command.drawId);
  if (draw === undefined) return refuse('not-found');
  const previous = latestPublished(facts.versions);
  if (draw.status !== 'draft' || draw.basedOnDrawId !== (previous?.id ?? null))
    return refuse('stale-draft');
  if (facts.tabRound.timing === 'live' && facts.tabRound.timeSlot === null)
    return refuse('slot-unset');
  if (
    facts.settings.kind !== 'resolved' ||
    facts.settings.digest !== draw.inputs.settingsDigest
  )
    return refuse('inputs-changed');
  if (previous !== null && sameSet(previous.fixtureIds, draw.fixtureIds))
    return refuse('draw-unchanged');
  if (command.overrides.some((override) => override.reason.trim().length === 0))
    return refuse('reason-required');
  const overridden = new Set(command.overrides.map((override) => override.key));
  if (
    draw.inputs.broken.some(
      (key) => !overridden.has(key as DrawOverride['key']),
    )
  )
    return refuse('rule-broken');
  const byId = fixtureById(facts);
  const leftOut = (previous?.fixtureIds ?? [])
    .filter((id) => !draw.fixtureIds.includes(id))
    .flatMap((id) => byId.get(id) ?? [])
    .filter((fixture) => fixture.status === 'published');
  if (
    leftOut.some(
      (fixture) => fixture.state !== null && !isRepairable(fixture.state),
    )
  )
    return refuse('fixture-started');
  const held = draw.fixtureIds.flatMap((id) => byId.get(id) ?? []);
  const booked = doubleBooked(held, new Set(facts.slotElsewhere));
  if (booked.judges) return refuse('judge-double-booked');
  if (booked.entries) return refuse('slot-clash');
  const unpublished = held.filter((fixture) => fixture.status === 'draft');
  const roomed = unpublished.filter((fixture) => fixture.kind !== 'bye');
  const ids = freshIdsFor(facts, roomed.length + facts.releasesAtOnce.length);
  if (ids === null) return refuse('fresh-ids-short');
  const roomIdOf = (fixture: DrawFixtureFacts) =>
    fixture.kind === 'bye' ? null : ids[roomed.indexOf(fixture)]!;
  const base = child(facts);
  const now = facts.now;
  const withdrawals = leftOut.flatMap((fixture): DrawWrite[] => [
    {
      table: 'fixtures',
      op: 'update',
      where: { id: fixture.id },
      set: { status: 'withdrawn', withdrawnAt: now },
    },
    ...(fixture.roomId === null
      ? []
      : [
          {
            table: 'rooms',
            op: 'update',
            where: { id: fixture.roomId },
            set: { status: 'closed' },
          } as const,
        ]),
  ]);
  const publications = unpublished.flatMap((fixture): DrawWrite[] => {
    const roomId = roomIdOf(fixture);
    return [
      ...(roomId === null
        ? []
        : [
            {
              table: 'rooms',
              op: 'insert',
              row: {
                id: roomId,
                lobbyId: facts.event.lobbyId,
                lobbyKind: 'tournament',
                title: roomTitle(facts),
                status: 'assembling',
                formatId: facts.event.formatId,
                formatVersion: facts.event.formatVersion,
                templateId: facts.event.templateId,
                ballotDefinitionId: facts.event.ballotDefinitionId,
                ballotDefinitionVersion: facts.event.ballotDefinitionVersion,
              },
            } as const,
            ...[...new Set(peopleOf(fixture))].map(
              (actorId) =>
                ({
                  table: 'room_participants',
                  op: 'insert',
                  row: { roomId, actorId },
                }) as const,
            ),
          ]),
      {
        table: 'fixtures',
        op: 'update',
        where: { id: fixture.id },
        set: { status: 'published', publishedAt: now, roomId },
      },
    ];
  });
  const releases = facts.releasesAtOnce.map((release, index): DrawWrite => ({
    table: 'releases',
    op: 'insert',
    row: {
      ...base,
      id: ids[roomed.length + index]!,
      thing: release.thing,
      audience: release.audience,
      cause: 'at_once',
      commandId: facts.commandId,
      openedAt: now,
    },
  }));
  return onDraw(
    draw.id,
    draw.version,
    [
      ...withdrawals,
      ...publications,
      {
        table: 'draws',
        op: 'update',
        where: { id: draw.id },
        set: {
          status: 'published',
          publishedAt: now,
          inputs: { ...draw.inputs, overrides: command.overrides },
        },
      },
      ...releases,
      ...slotBump(facts),
    ],
    [],
    fixtureChangesOf(
      {
        tabRoundId: facts.tabRound.id,
        drawVersion: draw.version,
        fixtures: seated(draw, byId),
      },
      previous === null
        ? null
        : {
            tabRoundId: facts.tabRound.id,
            drawVersion: previous.version,
            fixtures: seated(previous, byId),
          },
    ),
  );
};

const discardDraft = (
  facts: DrawFacts,
  command: Extract<DrawCommand, { type: 'discard-draft' }>,
): DrawDecision => {
  const draw = facts.versions.find((version) => version.id === command.drawId);
  if (draw === undefined) return refuse('not-found');
  if (draw.status !== 'draft') return refuse('stale-draft');
  const byId = fixtureById(facts);
  const heldElsewhere = new Set(
    facts.versions
      .filter((version) => version.id !== draw.id)
      .flatMap((version) => version.fixtureIds),
  );
  const orphans = draw.fixtureIds.filter(
    (id) => byId.get(id)?.status === 'draft' && !heldElsewhere.has(id),
  );
  return onDraw(draw.id, draw.version, [
    { table: 'draws', op: 'delete', where: { id: draw.id } },
    ...orphans.flatMap((id): DrawWrite[] => [
      { table: 'fixture_entries', op: 'delete', where: { fixtureId: id } },
      { table: 'fixture_judges', op: 'delete', where: { fixtureId: id } },
      { table: 'fixtures', op: 'delete', where: { id } },
    ]),
  ]);
};

/**
 * Decides one draw command from its facts, calling the tab engine through
 * its port. A version is made only when the set of fixtures changes; a
 * publish withdraws each live fixture it leaves out, which only a fixture
 * whose Round has not started allows, and breaks a rule only under an
 * override that gives its reason.
 *
 * Requirement on the Postgres transaction port (wiring's): a writer locks
 * the tab round's `draws` rows `FOR UPDATE` in `facts()`, before it adds
 * anything to a draft (`draw_fixtures`, `fixtures`, `fixture_entries`,
 * `fixture_judges`). The publish guard reads a draft's child lists under a
 * share lock, so a writer that adds to the draft first and locks the draw
 * after deadlocks against a publish.
 */
export const decideDraw =
  (engine: TabEngine) =>
  (facts: DrawFacts, command: DrawCommand): DrawDecision => {
    switch (command.type) {
      case 'generate-draw':
        return generateDraw(engine, facts, command);
      case 'assign-judges':
        return assignJudges(engine, facts, command);
      case 'edit-draw':
        return editDraw(engine, facts, command);
      case 'publish-draw':
        return publishDraw(facts, command);
      case 'discard-draft':
        return discardDraft(facts, command);
    }
  };
