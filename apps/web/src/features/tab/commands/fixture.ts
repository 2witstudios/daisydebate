import type {
  CommandFinding,
  FixtureChange,
} from '@daisy/protocol/lobby/command';
import type {
  FixtureCommand,
  FixtureCommandRefusal,
  JudgingOverride,
} from '@daisy/protocol/lobby/fixture-command';
import type { Force } from '@daisy/protocol/setting-forces';
import type { SettingValues } from '@daisy/protocol/setting-values';
import type {
  administrativeResultReasons,
  fixtureKinds,
  fixtureStatuses,
  judgeStrikeSources,
  resultKinds,
  StageKind,
  tournamentJudgeStatuses,
} from '@daisy/protocol/lobby';
import type { RoundStatus } from '@daisy/protocol';
import { refuse, type CommandDecision } from './run-command';

/**
 * Fixture officiating (TAB-5.12): a fixture's judges, its Room's restart and
 * its forfeit. Every refusal reads the fixture's state from one function,
 * `fixtureStateOf`, which is the state table of the slice plan. No command
 * here makes a draw version or touches a fixture's entries.
 */

/** A `fixtures` row, as loaded under the fixture's lock. */
export type FixtureRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly tabRoundId: string;
  readonly kind: (typeof fixtureKinds)[number];
  readonly status: (typeof fixtureStatuses)[number];
  readonly roomId: string | null;
  readonly version: number;
};
/** A `fixture_entries` row with its entry's school. */
export type FixtureEntryRow = {
  readonly entryId: string;
  readonly side: string | null;
  readonly schoolOrganizationId: string | null;
};
/** An `entry_members` row of one of the fixture's entries. */
export type EntryMemberRow = {
  readonly entryId: string;
  readonly actorId: string;
};
/** A `fixture_judges` row of this fixture. */
export type FixtureJudgeRow = {
  readonly tournamentJudgeId: string;
  readonly chair: boolean;
};
/**
 * A `tournament_judges` row, with whether `judge_availability` makes them
 * available in the tab round's time slot (null: the tab round has no slot)
 * and whether `judge_events` allows them this event.
 */
export type TournamentJudgeRow = {
  readonly id: string;
  readonly actorId: string;
  readonly schoolOrganizationId: string | null;
  readonly status: (typeof tournamentJudgeStatuses)[number];
  readonly chairQualified: boolean;
  readonly availableInSlot: boolean | null;
  readonly allowedEvent: boolean;
};
/** A `judge_strikes` row between a judge and one of the fixture's entries. */
export type JudgeStrikeRow = {
  readonly entryId: string;
  readonly tournamentJudgeId: string;
  readonly source: (typeof judgeStrikeSources)[number];
};
/** A `fixture_judges` row of another published fixture in the same time slot. */
export type SlotBookingRow = {
  readonly fixtureId: string;
  readonly tournamentJudgeId: string;
};
/** The `rounds` row of the fixture's current Room, once its Round has started. */
export type RoundRow = { readonly id: string; readonly status: RoundStatus };
/** A `ballots` row of that Round, with its judge's actor from `round_participants`. */
export type BallotRow = {
  readonly id: string;
  readonly judgeActorId: string;
  readonly winner: string;
};
/** A `results` row of this fixture. */
export type ResultRow = {
  readonly id: string;
  readonly kind: (typeof resultKinds)[number];
  readonly administrativeReason:
    (typeof administrativeResultReasons)[number] | null;
  readonly roundId: string | null;
  readonly supersedesResultId: string | null;
  readonly recordedAt: string;
};

/** The `judging.*` rules a judge assignment is checked against. */
export const evaluatedJudgingRules = [
  'judging.availability',
  'judging.strike',
  'judging.conflict',
  'judging.same_school',
  'judging.chair',
] as const;
export type EvaluatedJudgingRule = (typeof evaluatedJudgingRules)[number];

/** Everything about one fixture the record says, read under its lock. */
export type FixtureRecord = {
  readonly fixture: FixtureRow;
  readonly entries: readonly FixtureEntryRow[];
  readonly members: readonly EntryMemberRow[];
  readonly panel: readonly FixtureJudgeRow[];
  readonly round: RoundRow | null;
  readonly ballots: readonly BallotRow[];
  readonly results: readonly ResultRow[];
};

export type FixtureFacts = FixtureRecord & {
  /** The command's id and instant, and the ids minted for what it may create. */
  readonly commandId: string;
  readonly now: string;
  readonly minted: { readonly resultId: string; readonly roomId: string };
  readonly stageKind: StageKind;
  /** The event's resolved `judging.panel` and the forces of the rules checked. */
  readonly judgingPanel: SettingValues['judging.panel'];
  readonly judgingForces: { readonly [Rule in EvaluatedJudgingRule]: Force };
  /** The panel's judges and every judge the command names. */
  readonly judges: readonly TournamentJudgeRow[];
  readonly strikes: readonly JudgeStrikeRow[];
  readonly slotBookings: readonly SlotBookingRow[];
};

/** A `results` row and its `result_entries`, written together. */
export type ResultRowWrite = {
  readonly table: 'results';
  readonly op: 'insert';
  readonly row: {
    readonly id: string;
    readonly lobbyId: string;
    readonly eventId: string;
    readonly tabRoundId: string;
    readonly fixtureId: string;
    readonly kind: (typeof resultKinds)[number];
    readonly administrativeReason:
      (typeof administrativeResultReasons)[number] | null;
    readonly roundId: string | null;
    readonly supersedesResultId: string | null;
    readonly correctionReason: string | null;
    readonly commandId: string;
    readonly recordedAt: string;
  };
};
export type ResultEntryWrite = {
  readonly table: 'result_entries';
  readonly op: 'insert';
  readonly row: {
    readonly resultId: string;
    readonly entryId: string;
    readonly fixtureId: string;
    readonly lobbyId: string;
    readonly won: boolean | null;
    readonly rank: number | null;
    readonly ballotsWon: number | null;
  };
};

export type FixtureWrite =
  | {
      readonly table: 'fixture_judges';
      readonly op: 'insert';
      readonly row: {
        readonly fixtureId: string;
        readonly tabRoundId: string;
        readonly eventId: string;
        readonly lobbyId: string;
        readonly fixtureStatus: FixtureRow['status'];
        readonly tournamentJudgeId: string;
        readonly chair: boolean;
      };
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'update';
      readonly fixtureId: string;
      readonly tournamentJudgeId: string;
      readonly set: { readonly chair: boolean };
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'delete';
      readonly fixtureId: string;
      readonly tournamentJudgeId: string;
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly version: number; readonly roomId?: string };
    }
  | {
      readonly table: 'rounds';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly status: Extract<RoundStatus, 'abandoned'> };
    }
  | {
      /** A new event Room pinned and seated as the Room it replaces. */
      readonly table: 'rooms';
      readonly op: 'insert';
      readonly id: string;
      readonly likeRoomId: string;
    }
  | ResultRowWrite
  | ResultEntryWrite;

/** Where a fixture is in its life: the rows of the plan's state table. */
export type FixtureState =
  | 'draft'
  | 'not_started'
  | 'round_started'
  | 'ballot_in'
  | 'has_result'
  | 'withdrawn';

/** The one place a fixture's state is read from its facts. */
export const fixtureStateOf = (
  record: Pick<FixtureRecord, 'fixture' | 'round' | 'ballots' | 'results'>,
): FixtureState => {
  switch (record.fixture.status) {
    case 'draft':
      return 'draft';
    case 'withdrawn':
      return 'withdrawn';
    case 'published':
      if (record.results.length > 0) return 'has_result';
      if (record.ballots.length > 0) return 'ballot_in';
      return record.round === null ? 'not_started' : 'round_started';
  }
};

/** What the state table refuses a judge command, or a forfeit or restart. */
const officiatingRefusal = (
  state: FixtureState,
  kind: FixtureRow['kind'],
  needsRoom: 'published' | 'any',
): FixtureCommandRefusal | null => {
  switch (state) {
    case 'withdrawn':
      return 'fixture-withdrawn';
    case 'has_result':
      return 'result-exists';
    case 'draft':
      if (needsRoom === 'published') return 'fixture-unpublished';
      return kind === 'bye' ? 'fixture-bye' : null;
    case 'not_started':
    case 'round_started':
    case 'ballot_in':
      return kind === 'bye' ? 'fixture-bye' : null;
  }
};

const isBlank = (text: string) => text.trim().length === 0;

const submittedActors = (record: FixtureRecord): ReadonlySet<string> =>
  new Set(record.ballots.map((ballot) => ballot.judgeActorId));

const judgeOf = (facts: FixtureFacts, id: string) =>
  facts.judges.find((judge) => judge.id === id) ?? null;

/** The actors seated in the fixture's Room for a given panel. */
const seatedActors = (
  facts: FixtureFacts,
  panel: readonly FixtureJudgeRow[],
): readonly string[] => [
  ...facts.members.map((member) => member.actorId),
  ...panel.flatMap((seat) => {
    const judge = judgeOf(facts, seat.tournamentJudgeId);
    return judge === null ? [] : [judge.actorId];
  }),
];

/** One officiating command as people are told it; a draft fixture tells nobody. */
const officiated = (
  facts: FixtureFacts,
  type: FixtureCommand['type'],
  panelAfter: readonly FixtureJudgeRow[],
): readonly FixtureChange[] =>
  facts.fixture.status === 'published'
    ? [
        {
          kind: 'officiated',
          fixtureId: facts.fixture.id,
          tabRoundId: facts.fixture.tabRoundId,
          commandId: facts.commandId,
          type,
          people: [
            ...new Set([
              ...seatedActors(facts, facts.panel),
              ...seatedActors(facts, panelAfter),
            ]),
          ],
        },
      ]
    : [];

type RuleCheck =
  | { readonly kind: 'refused'; readonly refusal: FixtureCommandRefusal }
  | { readonly kind: 'kept'; readonly findings: readonly CommandFinding[] };

/** The `judging.*` rules seating `judge` (as chair or not) would break. */
const brokenRules = (
  facts: FixtureFacts,
  judge: TournamentJudgeRow,
  chair: boolean,
): readonly EvaluatedJudgingRule[] => {
  const strikes = facts.strikes.filter(
    (strike) => strike.tournamentJudgeId === judge.id,
  );
  const broken: Readonly<Record<EvaluatedJudgingRule, boolean>> = {
    'judging.availability': judge.availableInSlot === false,
    'judging.strike': strikes.some((strike) => strike.source === 'entry'),
    'judging.conflict': strikes.some((strike) => strike.source !== 'entry'),
    'judging.same_school':
      judge.schoolOrganizationId !== null &&
      facts.entries.some(
        (entry) => entry.schoolOrganizationId === judge.schoolOrganizationId,
      ),
    'judging.chair': chair && !judge.chairQualified,
  };
  return evaluatedJudgingRules.filter((rule) => broken[rule]);
};

/**
 * A broken `rule` is refused unless an override names its key with a
 * reason; a broken `preference` or `warning` is reported; `off` is not
 * applied.
 */
const checkRules = (
  facts: FixtureFacts,
  judge: TournamentJudgeRow,
  chair: boolean,
  overrides: readonly JudgingOverride[],
): RuleCheck => {
  const findings: CommandFinding[] = [];
  for (const rule of brokenRules(facts, judge, chair)) {
    const force = facts.judgingForces[rule];
    switch (force) {
      case 'rule': {
        const override = overrides.find((entry) => entry.key === rule);
        if (override === undefined)
          return { kind: 'refused', refusal: 'rule-broken' };
        if (isBlank(override.reason))
          return { kind: 'refused', refusal: 'reason-required' };
        break;
      }
      case 'preference':
      case 'warning':
        findings.push({ kind: force, key: rule, detail: judge.id });
        break;
      case 'off':
        break;
    }
  }
  return { kind: 'kept', findings };
};

type Seating =
  | {
      readonly kind: 'refused';
      readonly refusal: FixtureCommandRefusal | 'not-found';
    }
  | {
      readonly kind: 'seated';
      readonly panel: readonly FixtureJudgeRow[];
      readonly writes: readonly FixtureWrite[];
      readonly findings: readonly CommandFinding[];
    };

/** Seats `judgeId` on `panel`, every check of `assign-judge` but the state's. */
const seat = (
  facts: FixtureFacts,
  panel: readonly FixtureJudgeRow[],
  judgeId: string,
  chair: boolean,
  overrides: readonly JudgingOverride[],
): Seating => {
  if (panel.some((row) => row.tournamentJudgeId === judgeId))
    return { kind: 'refused', refusal: 'judge-on-panel' };
  if (panel.length >= facts.judgingPanel[facts.stageKind].size)
    return { kind: 'refused', refusal: 'panel-full' };
  const judge = judgeOf(facts, judgeId);
  if (judge === null) return { kind: 'refused', refusal: 'not-found' };
  if (judge.status !== 'accepted' || !judge.allowedEvent)
    return { kind: 'refused', refusal: 'judge-unavailable' };
  if (
    facts.slotBookings.some(
      (booking) =>
        booking.tournamentJudgeId === judgeId &&
        booking.fixtureId !== facts.fixture.id,
    )
  )
    return { kind: 'refused', refusal: 'judge-double-booked' };
  const rules = checkRules(facts, judge, chair, overrides);
  if (rules.kind === 'refused') return rules;
  const formerChair = chair ? panel.find((row) => row.chair) : undefined;
  const { fixture } = facts;
  return {
    kind: 'seated',
    panel: [
      ...panel.map((row) =>
        row === formerChair ? { ...row, chair: false } : row,
      ),
      { tournamentJudgeId: judgeId, chair },
    ],
    writes: [
      ...(formerChair === undefined
        ? []
        : [
            {
              table: 'fixture_judges',
              op: 'update',
              fixtureId: fixture.id,
              tournamentJudgeId: formerChair.tournamentJudgeId,
              set: { chair: false },
            } as const,
          ]),
      {
        table: 'fixture_judges',
        op: 'insert',
        row: {
          fixtureId: fixture.id,
          tabRoundId: fixture.tabRoundId,
          eventId: fixture.eventId,
          lobbyId: fixture.lobbyId,
          fixtureStatus: fixture.status,
          tournamentJudgeId: judgeId,
          chair,
        },
      },
    ],
    findings: rules.findings,
  };
};

type Unseating =
  | { readonly kind: 'refused'; readonly refusal: FixtureCommandRefusal }
  | {
      readonly kind: 'unseated';
      readonly removed: FixtureJudgeRow;
      readonly panel: readonly FixtureJudgeRow[];
      readonly write: FixtureWrite;
    };

/** Takes `judgeId` off the panel, unless they have submitted their ballot. */
const unseat = (facts: FixtureFacts, judgeId: string): Unseating => {
  const removed = facts.panel.find((row) => row.tournamentJudgeId === judgeId);
  if (removed === undefined)
    return { kind: 'refused', refusal: 'judge-not-on-panel' };
  const judge = judgeOf(facts, judgeId);
  if (judge !== null && submittedActors(facts).has(judge.actorId))
    return { kind: 'refused', refusal: 'ballot-submitted' };
  return {
    kind: 'unseated',
    removed,
    panel: facts.panel.filter((row) => row !== removed),
    write: {
      table: 'fixture_judges',
      op: 'delete',
      fixtureId: facts.fixture.id,
      tournamentJudgeId: judgeId,
    },
  };
};

/** One result row, as every command that records a result writes it. */
export const resultRowWrite = (
  record: FixtureRecord,
  context: {
    readonly id: string;
    readonly commandId: string;
    readonly now: string;
  },
  result: Pick<
    ResultRowWrite['row'],
    | 'kind'
    | 'administrativeReason'
    | 'roundId'
    | 'supersedesResultId'
    | 'correctionReason'
  >,
): ResultRowWrite => ({
  table: 'results',
  op: 'insert',
  row: {
    id: context.id,
    lobbyId: record.fixture.lobbyId,
    eventId: record.fixture.eventId,
    tabRoundId: record.fixture.tabRoundId,
    fixtureId: record.fixture.id,
    ...result,
    commandId: context.commandId,
    recordedAt: context.now,
  },
});

export const resultEntryWrite = (
  record: FixtureRecord,
  resultId: string,
  outcome: Pick<
    ResultEntryWrite['row'],
    'entryId' | 'won' | 'rank' | 'ballotsWon'
  >,
): ResultEntryWrite => ({
  table: 'result_entries',
  op: 'insert',
  row: {
    resultId,
    fixtureId: record.fixture.id,
    lobbyId: record.fixture.lobbyId,
    ...outcome,
  },
});

/**
 * The `decided` result a complete panel makes: each entry's ballots are
 * those naming its side, and an entry wins with a majority of them.
 */
const decidedResultWrites = (
  facts: FixtureFacts,
  round: RoundRow,
): readonly FixtureWrite[] => {
  const id = facts.minted.resultId;
  const tally = (side: string | null) =>
    facts.ballots.filter((ballot) => ballot.winner === side).length;
  return [
    resultRowWrite(
      facts,
      { id, commandId: facts.commandId, now: facts.now },
      {
        kind: 'decided',
        administrativeReason: null,
        roundId: round.id,
        supersedesResultId: null,
        correctionReason: null,
      },
    ),
    ...facts.entries.map((entry) =>
      resultEntryWrite(facts, id, {
        entryId: entry.entryId,
        won: tally(entry.side) * 2 > facts.ballots.length,
        rank: null,
        ballotsWon: tally(entry.side),
      }),
    ),
  ];
};

const accepted = (
  facts: FixtureFacts,
  type: FixtureCommand['type'],
  panelAfter: readonly FixtureJudgeRow[],
  writes: readonly FixtureWrite[],
  findings: readonly CommandFinding[] = [],
  roomId?: string,
): CommandDecision<FixtureCommandRefusal | 'not-found', FixtureWrite> => {
  const version = facts.fixture.version + 1;
  return {
    kind: 'accepted',
    aggregate: { kind: 'fixture', id: facts.fixture.id },
    resultingVersion: version,
    writes: [
      ...writes,
      {
        table: 'fixtures',
        op: 'update',
        id: facts.fixture.id,
        set: roomId === undefined ? { version } : { version, roomId },
      },
    ],
    findings,
    fixtureChanges: officiated(facts, type, panelAfter),
  };
};

type Decision = CommandDecision<
  FixtureCommandRefusal | 'not-found',
  FixtureWrite
>;
type Of<Type extends FixtureCommand['type']> = Extract<
  FixtureCommand,
  { readonly type: Type }
>;

const assignJudge = (
  facts: FixtureFacts,
  command: Of<'assign-judge'>,
): Decision => {
  const seated = seat(
    facts,
    facts.panel,
    command.judgeId,
    command.chair,
    command.overrides,
  );
  if (seated.kind === 'refused') return refuse(seated.refusal);
  return accepted(
    facts,
    command.type,
    seated.panel,
    seated.writes,
    seated.findings,
  );
};

const replaceJudge = (
  facts: FixtureFacts,
  command: Of<'replace-judge'>,
): Decision => {
  const unseated = unseat(facts, command.outJudgeId);
  if (unseated.kind === 'refused') return refuse(unseated.refusal);
  const seated = seat(
    facts,
    unseated.panel,
    command.inJudgeId,
    unseated.removed.chair,
    command.overrides,
  );
  if (seated.kind === 'refused') return refuse(seated.refusal);
  return accepted(
    facts,
    command.type,
    seated.panel,
    [unseated.write, ...seated.writes],
    seated.findings,
  );
};

/** Once a ballot is in, the panel is complete when every judge left has submitted. */
const completedRound = (
  facts: FixtureFacts,
  panel: readonly FixtureJudgeRow[],
): RoundRow | null => {
  if (fixtureStateOf(facts) !== 'ballot_in' || panel.length === 0) return null;
  const submitted = submittedActors(facts);
  const complete = panel.every((row) => {
    const judge = judgeOf(facts, row.tournamentJudgeId);
    return judge !== null && submitted.has(judge.actorId);
  });
  return complete ? facts.round : null;
};

const unassignJudge = (
  facts: FixtureFacts,
  command: Of<'unassign-judge'>,
): Decision => {
  const unseated = unseat(facts, command.judgeId);
  if (unseated.kind === 'refused') return refuse(unseated.refusal);
  const round = completedRound(facts, unseated.panel);
  return accepted(facts, command.type, unseated.panel, [
    unseated.write,
    ...(round === null ? [] : decidedResultWrites(facts, round)),
  ]);
};

const restartFixture = (
  facts: FixtureFacts,
  command: Of<'restart-fixture'>,
): Decision => {
  if (facts.round === null || facts.fixture.roomId === null)
    return refuse('round-not-started');
  if (isBlank(command.reason)) return refuse('reason-required');
  return accepted(
    facts,
    command.type,
    facts.panel,
    [
      {
        table: 'rounds',
        op: 'update',
        id: facts.round.id,
        set: { status: 'abandoned' },
      },
      {
        table: 'rooms',
        op: 'insert',
        id: facts.minted.roomId,
        likeRoomId: facts.fixture.roomId,
      },
    ],
    [],
    facts.minted.roomId,
  );
};

const recordForfeit = (
  facts: FixtureFacts,
  command: Of<'record-forfeit'>,
): Decision => {
  if (!facts.entries.some((entry) => entry.entryId === command.entryId))
    return refuse('entry-not-in-fixture');
  if (isBlank(command.reason)) return refuse('reason-required');
  const id = facts.minted.resultId;
  return accepted(facts, command.type, facts.panel, [
    resultRowWrite(
      facts,
      { id, commandId: facts.commandId, now: facts.now },
      {
        kind: 'administrative',
        administrativeReason: 'forfeit',
        roundId: facts.round?.id ?? null,
        supersedesResultId: null,
        correctionReason: null,
      },
    ),
    ...facts.entries.map((entry) =>
      resultEntryWrite(facts, id, {
        entryId: entry.entryId,
        won: entry.entryId !== command.entryId,
        rank: null,
        ballotsWon: null,
      }),
    ),
  ]);
};

/** Judge commands also serve a draft fixture; a restart or forfeit needs it published. */
const needsPublished = (type: FixtureCommand['type']): 'published' | 'any' => {
  switch (type) {
    case 'assign-judge':
    case 'replace-judge':
    case 'unassign-judge':
      return 'any';
    case 'restart-fixture':
    case 'record-forfeit':
      return 'published';
  }
};

/**
 * Decides one officiating command from the fixture's facts. Authority is the
 * runner's gate; time and new ids come in the facts.
 */
export const decideFixture = (
  facts: FixtureFacts,
  command: FixtureCommand,
): Decision => {
  if (command.fixtureId !== facts.fixture.id) return refuse('not-found');
  const refusal = officiatingRefusal(
    fixtureStateOf(facts),
    facts.fixture.kind,
    needsPublished(command.type),
  );
  if (refusal !== null) return refuse(refusal);
  switch (command.type) {
    case 'assign-judge':
      return assignJudge(facts, command);
    case 'replace-judge':
      return replaceJudge(facts, command);
    case 'unassign-judge':
      return unassignJudge(facts, command);
    case 'restart-fixture':
      return restartFixture(facts, command);
    case 'record-forfeit':
      return recordForfeit(facts, command);
  }
};
