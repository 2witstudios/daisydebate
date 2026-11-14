import type { SharedLobbyRefusal } from '@daisy/protocol/lobby/command';
import type {
  BallotDefinitionSettings,
  LobbySetupRefusal,
  TournamentSetupCommand,
} from '@daisy/protocol/lobby/lobby-setup-command';
import type { LobbyKind, StageKind } from '@daisy/protocol/lobby';
import type { SettingValues } from '@daisy/protocol/setting-values';
import { refuse, type CommandDecision } from './run-command';

/**
 * A tournament's setup (TAB-5.10): events, stages, tab rounds, time slots,
 * placing a tab round, ballot definitions and resolutions. Every command is
 * on the tournament's lobby and moves its version. The facts are the
 * tournament's structure as loaded; time and new ids come with them.
 */

type Command<Type extends TournamentSetupCommand['type']> = Extract<
  TournamentSetupCommand,
  { type: Type }
>;

export type SetupEventFact = {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
  readonly templateId: string | null;
  readonly version: number;
  readonly entryCount: number;
  readonly sanctionCount: number;
  /** The keys of the event's resolved `entry.divisions`. */
  readonly divisions: readonly string[];
  readonly resolutionMethod: SettingValues['resolution.rule']['method'];
  readonly doubleQualifier: SettingValues['break.double_qualifier']['value'];
  /** The accounts holding the event's entries. */
  readonly entrantUserIds: readonly string[];
};

export type StageFact = {
  readonly id: string;
  readonly eventId: string;
  readonly kind: StageKind;
  readonly sequence: number;
  readonly timing: 'live' | 'windowed';
  readonly version: number;
};

export type TabRoundFact = {
  readonly id: string;
  readonly eventId: string;
  readonly stageId: string;
  readonly number: number;
  readonly timeSlotId: string | null;
  readonly poolResolutionId: string | null;
  readonly version: number;
  readonly drawPublished: boolean;
};

export type TimeSlotFact = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly version: number;
};

/** A ballot definition the lobby may pin: Daisy's, its organization's or its own. */
export type BallotDefinitionFact = {
  readonly id: string;
  readonly lobbyId: string | null;
  readonly currentVersion: number;
};

/** A template the lobby may follow; `conflictsWithChain` is its enforced keys against the chain. */
export type TemplateFact = {
  readonly id: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
  readonly retiredAt: string | null;
  readonly conflictsWithChain: boolean;
};

/** A resolution pool the lobby may draw from, with its resolutions. */
export type ResolutionPoolFact = {
  readonly id: string;
  readonly lobbyId: string | null;
  readonly resolutions: readonly {
    readonly id: string;
    readonly retiredAt: string | null;
  }[];
};

export type SetupFacts = {
  readonly now: string;
  /** Ids minted at the edge: the row a command makes, and a pool it makes with it. */
  readonly newIds: { readonly primary: string; readonly secondary: string };
  readonly lobby: {
    readonly id: string;
    readonly kind: LobbyKind;
    readonly closedAt: string | null;
    readonly version: number;
  } | null;
  readonly events: readonly SetupEventFact[];
  readonly stages: readonly StageFact[];
  readonly tabRounds: readonly TabRoundFact[];
  readonly timeSlots: readonly TimeSlotFact[];
  /** The format revisions an event may pin. */
  readonly formats: readonly {
    readonly formatId: string;
    readonly formatVersion: number;
  }[];
  readonly ballotDefinitions: readonly BallotDefinitionFact[];
  readonly templates: readonly TemplateFact[];
  readonly resolutionPools: readonly ResolutionPoolFact[];
};

type Insert<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'insert';
  readonly row: Row;
};
type Update<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'update';
  readonly id: string;
  readonly set: Partial<Row>;
};
type Delete<Table extends string> = {
  readonly table: Table;
  readonly op: 'delete';
  readonly id: string;
};

type EventRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly name: string;
  readonly label: string | null;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
  readonly templateId: string | null;
  readonly entryKind: 'person' | 'team';
  readonly teamSize: number;
  readonly version: number;
};
type StageRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly kind: StageKind;
  readonly sequence: number;
  readonly division: string | null;
  readonly place: 'online' | 'in_person';
  readonly timing: 'live' | 'windowed';
  readonly windowOpensAt: string | null;
  readonly windowClosesAt: string | null;
  readonly version: number;
};
type TabRoundRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly stageId: string;
  readonly number: number;
  readonly name: string | null;
  readonly timeSlotId: string | null;
  readonly resolutionPoolId: string | null;
  readonly poolResolutionId: string | null;
  readonly version: number;
};
type TimeSlotRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly version: number;
};

/** The rows a setup command writes, on the merged tables' columns. */
export type SetupWrite =
  | Update<'lobbies', { readonly version: number }>
  | Insert<'events', Omit<EventRow, 'version'>>
  | Update<'events', EventRow>
  | Delete<'events'>
  | Insert<'stages', Omit<StageRow, 'version'>>
  | Update<'stages', StageRow>
  | Delete<'stages'>
  | Insert<'tab_rounds', Omit<TabRoundRow, 'version'>>
  | Update<'tab_rounds', TabRoundRow>
  | Delete<'tab_rounds'>
  | Insert<'time_slots', Omit<TimeSlotRow, 'version'>>
  | Update<'time_slots', TimeSlotRow>
  | Delete<'time_slots'>
  | Insert<
      'ballot_definitions',
      {
        readonly id: string;
        readonly lobbyId: string;
        readonly name: string;
        readonly currentVersion: number;
      }
    >
  | Update<'ballot_definitions', { readonly currentVersion: number }>
  | Insert<
      'ballot_definition_versions',
      {
        readonly ballotDefinitionId: string;
        readonly version: number;
        readonly lobbyId: string;
        readonly definition: BallotDefinitionSettings;
      }
    >
  | Insert<
      'resolution_pools',
      { readonly id: string; readonly lobbyId: string; readonly name: string }
    >
  | Insert<
      'pool_resolutions',
      {
        readonly id: string;
        readonly poolId: string;
        readonly lobbyId: string;
        readonly text: string;
      }
    >
  | Update<'pool_resolutions', { readonly retiredAt: string }>;

export type SetupRefusal = LobbySetupRefusal | SharedLobbyRefusal;
export type SetupDecision = CommandDecision<SetupRefusal, SetupWrite>;

type OpenTournament = {
  readonly id: string;
  /** The lobby's version once this command is applied. */
  readonly version: number;
};

const sameName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const maxOf = (values: readonly number[]): number => Math.max(0, ...values);

/** An accepted setup command: its rows and the lobby's next version. */
const writes = (
  lobby: OpenTournament,
  rows: readonly SetupWrite[],
): SetupDecision => ({
  kind: 'accepted',
  aggregate: { kind: 'lobby', id: lobby.id },
  resultingVersion: lobby.version,
  writes: [
    ...rows,
    {
      table: 'lobbies',
      op: 'update',
      id: lobby.id,
      set: { version: lobby.version },
    },
  ],
  findings: [],
  fixtureChanges: [],
});

/** A stage has started once one of its tab rounds has a published draw. */
const stageStarted = (facts: SetupFacts, stageId: string): boolean =>
  facts.tabRounds.some(
    (round) => round.stageId === stageId && round.drawPublished,
  );

const ballotDefinitionPinnable = (
  facts: SetupFacts,
  pin: { readonly id: string; readonly version: number } | null,
): boolean =>
  pin === null ||
  facts.ballotDefinitions.some(
    (definition) =>
      definition.id === pin.id && pin.version <= definition.currentVersion,
  );

/** The pool a tab round draws from, checked: usable, holding a live wording where one is named. */
const resolutionRefusal = (
  facts: SetupFacts,
  event: SetupEventFact,
  resolution: Command<'add-tab-round'>['resolution'],
): SetupRefusal | null => {
  if (resolution === null) return null;
  const pool = facts.resolutionPools.find(
    (candidate) => candidate.id === resolution.poolId,
  );
  if (pool === undefined) return 'not-found';
  if (resolution.poolResolutionId === null) return null;
  const wording = pool.resolutions.find(
    (candidate) => candidate.id === resolution.poolResolutionId,
  );
  if (wording === undefined) return 'not-found';
  if (wording.retiredAt !== null) return 'resolution-retired';
  return event.resolutionMethod === 'fixed' ? null : 'resolution-not-fixed';
};

const stageWindow = (timing: Command<'add-stage'>['timing']) =>
  timing.timing === 'windowed'
    ? {
        timing: 'windowed' as const,
        windowOpensAt: timing.opensAt,
        windowClosesAt: timing.closesAt,
      }
    : { timing: 'live' as const, windowOpensAt: null, windowClosesAt: null };

const addEvent = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'add-event'>,
): SetupDecision | SetupRefusal => {
  if (facts.events.some((event) => sameName(event.name, command.name)))
    return 'name-taken';
  const { pin } = command;
  let pinned: Pick<
    EventRow,
    | 'formatId'
    | 'formatVersion'
    | 'ballotDefinitionId'
    | 'ballotDefinitionVersion'
    | 'templateId'
  >;
  if (pin.kind === 'format') {
    const available = facts.formats.some(
      (format) =>
        format.formatId === pin.formatId &&
        format.formatVersion === pin.formatVersion,
    );
    if (!available) return 'format-unavailable';
    if (!ballotDefinitionPinnable(facts, pin.ballotDefinition))
      return 'not-found';
    pinned = {
      formatId: pin.formatId,
      formatVersion: pin.formatVersion,
      ballotDefinitionId: pin.ballotDefinition?.id ?? null,
      ballotDefinitionVersion: pin.ballotDefinition?.version ?? null,
      templateId: null,
    };
  } else {
    const template = facts.templates.find(
      (candidate) => candidate.id === pin.templateId,
    );
    if (template === undefined || template.retiredAt !== null)
      return 'template-unavailable';
    if (template.conflictsWithChain) return 'enforced-conflict';
    pinned = {
      formatId: template.formatId,
      formatVersion: template.formatVersion,
      ballotDefinitionId: template.ballotDefinitionId,
      ballotDefinitionVersion: template.ballotDefinitionVersion,
      templateId: template.id,
    };
  }
  return writes(lobby, [
    {
      table: 'events',
      op: 'insert',
      row: {
        id: facts.newIds.primary,
        lobbyId: lobby.id,
        name: command.name,
        label: command.label,
        ...pinned,
        entryKind: command.entry.kind,
        teamSize: command.entry.kind === 'team' ? command.entry.size : 1,
      },
    },
  ]);
};

const updateEvent = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'update-event'>,
): SetupDecision | SetupRefusal => {
  const event = facts.events.find(
    (candidate) => candidate.id === command.eventId,
  );
  if (event === undefined) return 'not-found';
  if (
    facts.events.some(
      (other) => other.id !== event.id && sameName(other.name, command.name),
    )
  )
    return 'name-taken';
  const ballot = command.ballotDefinition;
  const ballotChanges =
    (ballot?.id ?? null) !== event.ballotDefinitionId ||
    (ballot?.version ?? null) !== event.ballotDefinitionVersion;
  if (ballotChanges) {
    if (event.templateId !== null) return 'template-pinned';
    if (event.entryCount > 0) return 'entries-exist';
    if (!ballotDefinitionPinnable(facts, ballot)) return 'not-found';
  }
  return writes(lobby, [
    {
      table: 'events',
      op: 'update',
      id: event.id,
      set: {
        name: command.name,
        label: command.label,
        ballotDefinitionId: ballot?.id ?? null,
        ballotDefinitionVersion: ballot?.version ?? null,
        version: event.version + 1,
      },
    },
  ]);
};

const removeEvent = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'remove-event'>,
): SetupDecision | SetupRefusal => {
  const event = facts.events.find(
    (candidate) => candidate.id === command.eventId,
  );
  if (event === undefined) return 'not-found';
  if (event.entryCount > 0) return 'entries-exist';
  if (event.sanctionCount > 0) return 'event-sanctioned';
  return writes(lobby, [
    ...facts.tabRounds
      .filter((round) => round.eventId === event.id)
      .map((round): SetupWrite => ({
        table: 'tab_rounds',
        op: 'delete',
        id: round.id,
      })),
    ...facts.stages
      .filter((stage) => stage.eventId === event.id)
      .map((stage): SetupWrite => ({
        table: 'stages',
        op: 'delete',
        id: stage.id,
      })),
    { table: 'events', op: 'delete', id: event.id },
  ]);
};

const addStage = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'add-stage'>,
): SetupDecision | SetupRefusal => {
  const event = facts.events.find(
    (candidate) => candidate.id === command.eventId,
  );
  if (event === undefined) return 'not-found';
  if (command.division !== null && !event.divisions.includes(command.division))
    return 'division-unknown';
  const sequence =
    maxOf(
      facts.stages
        .filter((stage) => stage.eventId === event.id)
        .map((stage) => stage.sequence),
    ) + 1;
  return writes(lobby, [
    {
      table: 'stages',
      op: 'insert',
      row: {
        id: facts.newIds.primary,
        lobbyId: lobby.id,
        eventId: event.id,
        kind: command.kind,
        sequence,
        division: command.division,
        place: command.place,
        ...stageWindow(command.timing),
      },
    },
  ]);
};

const updateStage = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'update-stage'>,
): SetupDecision | SetupRefusal => {
  const stage = facts.stages.find(
    (candidate) => candidate.id === command.stageId,
  );
  const event = facts.events.find(
    (candidate) => candidate.id === stage?.eventId,
  );
  if (stage === undefined || event === undefined) return 'not-found';
  if (stageStarted(facts, stage.id)) return 'stage-started';
  if (
    command.division !== null &&
    (stage.kind !== 'elimination' ||
      !event.divisions.includes(command.division))
  )
    return 'division-unknown';
  if (
    command.timing.timing === 'windowed' &&
    facts.tabRounds.some(
      (round) => round.stageId === stage.id && round.timeSlotId !== null,
    )
  )
    return 'rounds-placed';
  return writes(lobby, [
    {
      table: 'stages',
      op: 'update',
      id: stage.id,
      set: {
        division: command.division,
        place: command.place,
        ...stageWindow(command.timing),
        version: stage.version + 1,
      },
    },
  ]);
};

const addTabRound = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'add-tab-round'>,
): SetupDecision | SetupRefusal => {
  const stage = facts.stages.find(
    (candidate) => candidate.id === command.stageId,
  );
  const event = facts.events.find(
    (candidate) => candidate.id === stage?.eventId,
  );
  if (stage === undefined || event === undefined) return 'not-found';
  const refusal = resolutionRefusal(facts, event, command.resolution);
  if (refusal !== null) return refusal;
  const number =
    maxOf(
      facts.tabRounds
        .filter((round) => round.stageId === stage.id)
        .map((round) => round.number),
    ) + 1;
  return writes(lobby, [
    {
      table: 'tab_rounds',
      op: 'insert',
      row: {
        id: facts.newIds.primary,
        lobbyId: lobby.id,
        eventId: event.id,
        stageId: stage.id,
        number,
        name: command.name,
        timeSlotId: null,
        resolutionPoolId: command.resolution?.poolId ?? null,
        poolResolutionId: command.resolution?.poolResolutionId ?? null,
      },
    },
  ]);
};

const updateTabRound = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'update-tab-round'>,
): SetupDecision | SetupRefusal => {
  const round = facts.tabRounds.find(
    (candidate) => candidate.id === command.tabRoundId,
  );
  const event = facts.events.find(
    (candidate) => candidate.id === round?.eventId,
  );
  if (round === undefined || event === undefined) return 'not-found';
  if (round.drawPublished) return 'draw-published';
  const refusal = resolutionRefusal(facts, event, command.resolution);
  if (refusal !== null) return refusal;
  return writes(lobby, [
    {
      table: 'tab_rounds',
      op: 'update',
      id: round.id,
      set: {
        name: command.name,
        resolutionPoolId: command.resolution?.poolId ?? null,
        poolResolutionId: command.resolution?.poolResolutionId ?? null,
        version: round.version + 1,
      },
    },
  ]);
};

/** A slot is in use while a tab round with a published draw sits in it. */
const slotInUse = (facts: SetupFacts, slotId: string): boolean =>
  facts.tabRounds.some(
    (round) => round.timeSlotId === slotId && round.drawPublished,
  );

const slotNameTaken = (
  facts: SetupFacts,
  name: string,
  except: string | null,
): boolean =>
  facts.timeSlots.some(
    (slot) => slot.id !== except && sameName(slot.name, name),
  );

const addTimeSlot = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'add-time-slot'>,
): SetupDecision | SetupRefusal => {
  if (slotNameTaken(facts, command.name, null)) return 'name-taken';
  return writes(lobby, [
    {
      table: 'time_slots',
      op: 'insert',
      row: {
        id: facts.newIds.primary,
        lobbyId: lobby.id,
        name: command.name,
        startsAt: command.startsAt,
      },
    },
  ]);
};

/** A slot in use may be renamed, but not moved. */
const updateTimeSlot = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'update-time-slot'>,
): SetupDecision | SetupRefusal => {
  const slot = facts.timeSlots.find(
    (candidate) => candidate.id === command.timeSlotId,
  );
  if (slot === undefined) return 'not-found';
  if (slotNameTaken(facts, command.name, slot.id)) return 'name-taken';
  if (
    Date.parse(command.startsAt) !== Date.parse(slot.startsAt) &&
    slotInUse(facts, slot.id)
  )
    return 'slot-in-use';
  return writes(lobby, [
    {
      table: 'time_slots',
      op: 'update',
      id: slot.id,
      set: {
        name: command.name,
        startsAt: command.startsAt,
        version: slot.version + 1,
      },
    },
  ]);
};

/** Removing a slot takes its unpublished tab rounds out of it first. */
const removeTimeSlot = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'remove-time-slot'>,
): SetupDecision | SetupRefusal => {
  const slot = facts.timeSlots.find(
    (candidate) => candidate.id === command.timeSlotId,
  );
  if (slot === undefined) return 'not-found';
  if (slotInUse(facts, slot.id)) return 'slot-in-use';
  return writes(lobby, [
    ...facts.tabRounds
      .filter((round) => round.timeSlotId === slot.id)
      .map((round): SetupWrite => ({
        table: 'tab_rounds',
        op: 'update',
        id: round.id,
        set: { timeSlotId: null, version: round.version + 1 },
      })),
    { table: 'time_slots', op: 'delete', id: slot.id },
  ]);
};

/** The people who would hold entries in two events sharing the slot. */
export const slotClashes = (
  facts: SetupFacts,
  round: TabRoundFact,
  slotId: string,
): readonly string[] => {
  const entrants = (eventId: string) =>
    facts.events.find((event) => event.id === eventId)?.entrantUserIds ?? [];
  const placing = new Set(entrants(round.eventId));
  const sharing = new Set(
    facts.tabRounds
      .filter(
        (other) =>
          other.timeSlotId === slotId && other.eventId !== round.eventId,
      )
      .flatMap((other) => entrants(other.eventId)),
  );
  return [...placing].filter((userId) => sharing.has(userId)).sort();
};

/** Two of an event's breaks share a slot only while double qualifiers do not take both. */
const breaksShareSlot = (
  facts: SetupFacts,
  event: SetupEventFact,
  stage: StageFact,
  slotId: string,
): boolean => {
  if (stage.kind !== 'elimination' || event.doubleQualifier !== 'both')
    return false;
  const stageKind = (stageId: string) =>
    facts.stages.find((candidate) => candidate.id === stageId)?.kind;
  return facts.tabRounds.some(
    (other) =>
      other.timeSlotId === slotId &&
      other.eventId === event.id &&
      other.stageId !== stage.id &&
      stageKind(other.stageId) === 'elimination',
  );
};

const placeTabRound = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'place-tab-round'>,
): SetupDecision | SetupRefusal => {
  const round = facts.tabRounds.find(
    (candidate) => candidate.id === command.tabRoundId,
  );
  const stage = facts.stages.find(
    (candidate) => candidate.id === round?.stageId,
  );
  const event = facts.events.find(
    (candidate) => candidate.id === round?.eventId,
  );
  if (round === undefined || stage === undefined || event === undefined)
    return 'not-found';
  const target =
    command.timeSlotId === null
      ? null
      : facts.timeSlots.find((slot) => slot.id === command.timeSlotId);
  if (target === undefined) return 'not-found';
  if (round.drawPublished) return 'draw-published';
  if ((target?.id ?? null) === round.timeSlotId) return 'placement-unchanged';
  if (target !== null) {
    if (stage.timing === 'windowed') return 'stage-windowed';
    if (slotClashes(facts, round, target.id).length > 0) return 'slot-clash';
    if (breaksShareSlot(facts, event, stage, target.id))
      return 'breaks-share-slot';
  }
  const slotsTouched = facts.timeSlots.filter(
    (slot) => slot.id === target?.id || slot.id === round.timeSlotId,
  );
  return writes(lobby, [
    {
      table: 'tab_rounds',
      op: 'update',
      id: round.id,
      set: { timeSlotId: target?.id ?? null, version: round.version + 1 },
    },
    ...slotsTouched.map((slot): SetupWrite => ({
      table: 'time_slots',
      op: 'update',
      id: slot.id,
      set: { version: slot.version + 1 },
    })),
  ]);
};

/** Always a new version: a lobby's own definition, or the next version of one. */
const defineBallot = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'define-ballot'>,
): SetupDecision | SetupRefusal => {
  const { ballotDefinition } = command;
  if (ballotDefinition.kind === 'new') {
    const id = facts.newIds.primary;
    return writes(lobby, [
      {
        table: 'ballot_definitions',
        op: 'insert',
        row: {
          id,
          lobbyId: lobby.id,
          name: ballotDefinition.name,
          currentVersion: 1,
        },
      },
      {
        table: 'ballot_definition_versions',
        op: 'insert',
        row: {
          ballotDefinitionId: id,
          version: 1,
          lobbyId: lobby.id,
          definition: command.settings,
        },
      },
    ]);
  }
  const owned = facts.ballotDefinitions.find(
    (definition) =>
      definition.id === ballotDefinition.ballotDefinitionId &&
      definition.lobbyId === lobby.id,
  );
  if (owned === undefined) return 'not-found';
  const version = owned.currentVersion + 1;
  return writes(lobby, [
    {
      table: 'ballot_definition_versions',
      op: 'insert',
      row: {
        ballotDefinitionId: owned.id,
        version,
        lobbyId: lobby.id,
        definition: command.settings,
      },
    },
    {
      table: 'ballot_definitions',
      op: 'update',
      id: owned.id,
      set: { currentVersion: version },
    },
  ]);
};

const addResolution = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'add-resolution'>,
): SetupDecision | SetupRefusal => {
  const { pool } = command;
  const resolution = (poolId: string): SetupWrite => ({
    table: 'pool_resolutions',
    op: 'insert',
    row: {
      id: facts.newIds.primary,
      poolId,
      lobbyId: lobby.id,
      text: command.text,
    },
  });
  if (pool.kind === 'new') {
    const poolId = facts.newIds.secondary;
    return writes(lobby, [
      {
        table: 'resolution_pools',
        op: 'insert',
        row: { id: poolId, lobbyId: lobby.id, name: pool.name },
      },
      resolution(poolId),
    ]);
  }
  const owned = facts.resolutionPools.some(
    (candidate) =>
      candidate.id === pool.poolId && candidate.lobbyId === lobby.id,
  );
  return owned ? writes(lobby, [resolution(pool.poolId)]) : 'not-found';
};

const retireResolution = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: Command<'retire-resolution'>,
): SetupDecision | SetupRefusal => {
  const wording = facts.resolutionPools
    .filter((pool) => pool.lobbyId === lobby.id)
    .flatMap((pool) => pool.resolutions)
    .find((candidate) => candidate.id === command.poolResolutionId);
  if (wording === undefined) return 'not-found';
  if (wording.retiredAt !== null) return 'resolution-retired';
  if (facts.tabRounds.some((round) => round.poolResolutionId === wording.id))
    return 'resolution-in-use';
  return writes(lobby, [
    {
      table: 'pool_resolutions',
      op: 'update',
      id: wording.id,
      set: { retiredAt: facts.now },
    },
  ]);
};

const decideOn = (
  facts: SetupFacts,
  lobby: OpenTournament,
  command: TournamentSetupCommand,
): SetupDecision | SetupRefusal => {
  switch (command.type) {
    case 'add-event':
      return addEvent(facts, lobby, command);
    case 'update-event':
      return updateEvent(facts, lobby, command);
    case 'remove-event':
      return removeEvent(facts, lobby, command);
    case 'add-stage':
      return addStage(facts, lobby, command);
    case 'update-stage':
      return updateStage(facts, lobby, command);
    case 'add-tab-round':
      return addTabRound(facts, lobby, command);
    case 'update-tab-round':
      return updateTabRound(facts, lobby, command);
    case 'add-time-slot':
      return addTimeSlot(facts, lobby, command);
    case 'update-time-slot':
      return updateTimeSlot(facts, lobby, command);
    case 'remove-time-slot':
      return removeTimeSlot(facts, lobby, command);
    case 'place-tab-round':
      return placeTabRound(facts, lobby, command);
    case 'define-ballot':
      return defineBallot(facts, lobby, command);
    case 'add-resolution':
      return addResolution(facts, lobby, command);
    case 'retire-resolution':
      return retireResolution(facts, lobby, command);
  }
};

/** Decides one setup command on an open tournament lobby. */
export const decideSetup = (
  facts: SetupFacts,
  command: TournamentSetupCommand,
): SetupDecision => {
  const { lobby } = facts;
  if (lobby === null) return refuse('not-found');
  if (lobby.closedAt !== null) return refuse('lobby-closed');
  if (lobby.kind !== 'tournament') return refuse('lobby-not-tournament');
  const outcome = decideOn(
    facts,
    { id: lobby.id, version: lobby.version + 1 },
    command,
  );
  return typeof outcome === 'string' ? refuse(outcome) : outcome;
};
