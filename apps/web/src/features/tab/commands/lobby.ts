import type { RoomCreate } from '@daisy/protocol';
import type { SharedLobbyRefusal } from '@daisy/protocol/lobby/command';
import {
  isTournamentCancellable,
  isTournamentStatusForward,
  type LobbyCommand,
  type LobbySetupRefusal,
} from '@daisy/protocol/lobby/lobby-setup-command';
import type {
  LobbyKind,
  OrganizationKind,
  TournamentStatus,
} from '@daisy/protocol/lobby';
import type { SettingValues } from '@daisy/protocol/setting-values';
import { refuse, type CommandDecision } from './run-command';

/**
 * The lobby, season and ladder commands, and creating a Room in a standing
 * lobby (TAB-5.10): the rules that span rows, decided from loaded facts.
 * Authority is the runner's gate; time and new ids come in the facts.
 */

/** The lobby a command names, as loaded: a tournament carries its schedule row. */
export type LobbyFact =
  | {
      readonly kind: 'standing';
      readonly id: string;
      readonly ownerOrganizationId: string;
      readonly closedAt: string | null;
      readonly version: number;
    }
  | {
      readonly kind: 'tournament';
      readonly id: string;
      readonly ownerOrganizationId: string | null;
      readonly closedAt: string | null;
      readonly version: number;
      readonly status: TournamentStatus;
      readonly admitsMinors: boolean;
    };

export type SeasonFact = {
  readonly id: string;
  readonly organizationId: string;
  /** The `seasons.status` values. */
  readonly status: 'active' | 'closed';
  readonly version: number;
};

/** A template the lobby offers and has not withdrawn. */
export type OfferedTemplateFact = {
  readonly id: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
};

/** What a Room create in a standing lobby is checked against, resolved for the lobby. */
export type LobbyRoomFacts = {
  readonly offeredTemplates: readonly OfferedTemplateFact[];
  readonly ownFormat: SettingValues['room.own_format']['value'];
  readonly ownText: SettingValues['resolution.own_text']['value'];
  /** The `room.visibility` value where it is enforced; null where it is not. */
  readonly enforcedVisibility: SettingValues['room.visibility']['value'] | null;
};

export type LobbyFacts = {
  readonly now: string;
  /** An id minted at the edge for the row a creation command makes. */
  readonly newId: string;
  readonly actorUserId: string | null;
  /** Whether the new lobby's owner's plan allows a lobby of its kind. */
  readonly planAllows: boolean;
  readonly handleTaken: boolean;
  /** The organization the command names, if it exists. */
  readonly organization: {
    readonly id: string;
    readonly kind: OrganizationKind;
  } | null;
  readonly lobby: LobbyFact | null;
  readonly activity: {
    /** Rounds running in the lobby's Rooms. */
    readonly liveRoundCount: number;
    /** Published fixtures of the tournament with no result yet. */
    readonly unresultedFixtureCount: number;
    /** Event Rooms whose Round has not started. */
    readonly unstartedEventRoomIds: readonly string[];
  };
  /** The organization's active season, and the season the command names. */
  readonly activeSeasonId: string | null;
  readonly season: SeasonFact | null;
  /** The lobby's ladder, if it has one. */
  readonly ladder: { readonly id: string } | null;
  readonly room: LobbyRoomFacts;
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

type LobbyRow = {
  readonly id: string;
  readonly kind: LobbyKind;
  readonly ownerUserId: string | null;
  readonly ownerOrganizationId: string | null;
  readonly name: string;
  readonly handle: string;
  readonly closedAt: string | null;
  readonly version: number;
};
type TournamentRow = {
  readonly lobbyId: string;
  readonly status: TournamentStatus;
  readonly admitsMinors: boolean;
};
type SeasonRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: SeasonFact['status'];
  readonly version: number;
};

/** The rows a lobby command writes, on the merged tables' columns. */
export type LobbyWrite =
  | Insert<'lobbies', Omit<LobbyRow, 'closedAt' | 'version'>>
  | Update<'lobbies', LobbyRow>
  | Insert<'tournaments', TournamentRow>
  | Update<'tournaments', TournamentRow>
  | Update<'rooms', { readonly status: 'closed' }>
  | (Insert<
      'rooms',
      {
        readonly id: string;
        readonly lobbyId: string;
        readonly lobbyKind: 'standing';
        readonly templateId: string | null;
        readonly ballotDefinitionId: string | null;
        readonly ballotDefinitionVersion: number | null;
      }
    > & {
      /** The rest of the Room is assembled from the create as today. */
      readonly create: RoomCreate;
    })
  | Insert<'seasons', Omit<SeasonRow, 'version'>>
  | Update<'seasons', SeasonRow>
  | Insert<
      'season_standing_rules',
      {
        readonly seasonId: string;
        readonly organizationId: string;
        readonly counting: Extract<
          LobbyCommand,
          { type: 'create-season' }
        >['counting'];
        readonly countsLobbyRooms: boolean;
        readonly rule: Readonly<Record<string, unknown>>;
      }
    >
  | Insert<
      'ladders',
      {
        readonly id: string;
        readonly lobbyId: string;
        readonly organizationId: string;
        readonly name: string;
      }
    >
  | Delete<'ladders'>;

export type LobbyRefusal = LobbySetupRefusal | SharedLobbyRefusal;
export type LobbyDecision = CommandDecision<LobbyRefusal, LobbyWrite>;

const accepted = (
  aggregate: { readonly kind: 'lobby' | 'season'; readonly id: string },
  resultingVersion: number,
  writes: readonly LobbyWrite[],
): LobbyDecision => ({
  kind: 'accepted',
  aggregate,
  resultingVersion,
  writes,
  findings: [],
  fixtureChanges: [],
});

/** A lobby command after the lobby is found and open; the version moves with it. */
const onOpenLobby = (
  facts: LobbyFacts,
  decide: (lobby: LobbyFact, version: number) => LobbyDecision,
): LobbyDecision => {
  const { lobby } = facts;
  if (lobby === null) return refuse('not-found');
  if (lobby.closedAt !== null) return refuse('lobby-closed');
  return decide(lobby, lobby.version + 1);
};

const bump = (lobby: LobbyFact, version: number): LobbyWrite => ({
  table: 'lobbies',
  op: 'update',
  id: lobby.id,
  set: { version },
});

const createLobby = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'create-lobby' }>,
): LobbyDecision => {
  const { owner } = command;
  if (owner.kind === 'self') {
    if (command.lobby.kind === 'standing')
      return refuse('owner-not-organization');
    if (facts.actorUserId === null) return refuse('owner-not-organization');
  } else {
    if (facts.organization?.id !== owner.organizationId)
      return refuse('not-found');
    if (facts.organization.kind !== 'league') return refuse('owner-not-league');
  }
  if (!facts.planAllows) return refuse('plan-required');
  if (facts.handleTaken) return refuse('handle-taken');
  const lobbyId = facts.newId;
  const lobby: LobbyWrite = {
    table: 'lobbies',
    op: 'insert',
    row: {
      id: lobbyId,
      kind: command.lobby.kind,
      ownerUserId: owner.kind === 'self' ? facts.actorUserId : null,
      ownerOrganizationId:
        owner.kind === 'organization' ? owner.organizationId : null,
      name: command.name,
      handle: command.handle,
    },
  };
  const schedule: readonly LobbyWrite[] =
    command.lobby.kind === 'tournament'
      ? [
          {
            table: 'tournaments',
            op: 'insert',
            row: {
              lobbyId,
              status: 'draft',
              admitsMinors: command.lobby.admitsMinors,
            },
          },
        ]
      : [];
  return accepted({ kind: 'lobby', id: lobbyId }, 1, [lobby, ...schedule]);
};

const updateLobby = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'update-lobby' }>,
): LobbyDecision =>
  onOpenLobby(facts, (lobby, version) => {
    if (lobby.kind === 'standing' && command.admitsMinors !== null)
      return refuse('lobby-not-tournament');
    const minors: readonly LobbyWrite[] =
      lobby.kind === 'tournament' && command.admitsMinors !== null
        ? [
            {
              table: 'tournaments',
              op: 'update',
              id: lobby.id,
              set: { admitsMinors: command.admitsMinors },
            },
          ]
        : [];
    return accepted({ kind: 'lobby', id: lobby.id }, version, [
      {
        table: 'lobbies',
        op: 'update',
        id: lobby.id,
        set: { name: command.name, version },
      },
      ...minors,
    ]);
  });

const setTournamentStatus = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'set-tournament-status' }>,
): LobbyDecision =>
  onOpenLobby(facts, (lobby, version) => {
    if (lobby.kind !== 'tournament') return refuse('lobby-not-tournament');
    if (!isTournamentStatusForward(lobby.status, command.status))
      return refuse('status-order');
    if (command.status === 'completed') {
      if (facts.activity.liveRoundCount > 0) return refuse('rounds-running');
      if (facts.activity.unresultedFixtureCount > 0)
        return refuse('results-incomplete');
    }
    return accepted({ kind: 'lobby', id: lobby.id }, version, [
      {
        table: 'tournaments',
        op: 'update',
        id: lobby.id,
        set: { status: command.status },
      },
      bump(lobby, version),
    ]);
  });

/** Closing a tournament's lobby is the only way it is cancelled. */
const closeLobby = (facts: LobbyFacts): LobbyDecision =>
  onOpenLobby(facts, (lobby, version) => {
    if (facts.activity.liveRoundCount > 0) return refuse('rounds-running');
    const close: LobbyWrite = {
      table: 'lobbies',
      op: 'update',
      id: lobby.id,
      set: { closedAt: facts.now, version },
    };
    if (lobby.kind === 'standing')
      return accepted({ kind: 'lobby', id: lobby.id }, version, [close]);
    const cancel: readonly LobbyWrite[] = isTournamentCancellable(lobby.status)
      ? [
          {
            table: 'tournaments',
            op: 'update',
            id: lobby.id,
            set: { status: 'cancelled' },
          },
        ]
      : [];
    const rooms = facts.activity.unstartedEventRoomIds.map(
      (id): LobbyWrite => ({
        table: 'rooms',
        op: 'update',
        id,
        set: { status: 'closed' },
      }),
    );
    return accepted({ kind: 'lobby', id: lobby.id }, version, [
      close,
      ...cancel,
      ...rooms,
    ]);
  });

const createSeason = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'create-season' }>,
): LobbyDecision => {
  if (facts.organization?.id !== command.organizationId)
    return refuse('not-found');
  if (facts.organization.kind !== 'league') return refuse('owner-not-league');
  if (facts.activeSeasonId !== null) return refuse('season-open');
  const seasonId = facts.newId;
  return accepted({ kind: 'season', id: seasonId }, 1, [
    {
      table: 'seasons',
      op: 'insert',
      row: {
        id: seasonId,
        organizationId: command.organizationId,
        name: command.name,
        startsAt: command.startsAt,
        endsAt: command.endsAt,
        status: 'active',
      },
    },
    {
      table: 'season_standing_rules',
      op: 'insert',
      row: {
        seasonId,
        organizationId: command.organizationId,
        counting: command.counting,
        countsLobbyRooms: command.countsLobbyRooms,
        rule: command.rule,
      },
    },
  ]);
};

/** Closing freezes the season's standings inputs. */
const closeSeason = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'close-season' }>,
): LobbyDecision => {
  const { season } = facts;
  if (season?.id !== command.seasonId) return refuse('not-found');
  if (season.status === 'closed') return refuse('season-closed');
  const version = season.version + 1;
  return accepted({ kind: 'season', id: season.id }, version, [
    {
      table: 'seasons',
      op: 'update',
      id: season.id,
      set: { status: 'closed', version },
    },
  ]);
};

/** A league's ladder lies over its own standing lobby only. */
const setLadder = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'set-ladder' }>,
): LobbyDecision =>
  onOpenLobby(facts, (lobby, version) => {
    if (lobby.kind !== 'standing') return refuse('lobby-not-standing');
    if (lobby.ownerOrganizationId !== command.organizationId)
      return refuse('ladder-foreign');
    const { ladder } = facts;
    const done = (change: LobbyWrite) =>
      accepted({ kind: 'lobby', id: lobby.id }, version, [
        change,
        bump(lobby, version),
      ]);
    if (!command.ladder.enabled)
      return ladder === null
        ? refuse('ladder-unchanged')
        : done({ table: 'ladders', op: 'delete', id: ladder.id });
    if (ladder !== null) return refuse('ladder-unchanged');
    return done({
      table: 'ladders',
      op: 'insert',
      row: {
        id: facts.newId,
        lobbyId: lobby.id,
        organizationId: command.organizationId,
        name: command.ladder.name,
      },
    });
  });

/** Whether a Room's selection is the template's pinned format revision. */
const selectsTemplateFormat = (
  selection: RoomCreate['selection'],
  template: OfferedTemplateFact,
): boolean => {
  switch (selection.kind) {
    case 'catalog':
    case 'ranked':
      return (
        selection.formatId === template.formatId &&
        selection.formatVersion === template.formatVersion
      );
    case 'custom':
      return false;
  }
};

/**
 * A Room in a standing lobby follows a template the lobby offers, or the
 * host's own format where `room.own_format` allows. Making a Room does not
 * move the lobby's version.
 */
const createLobbyRoom = (
  facts: LobbyFacts,
  command: Extract<LobbyCommand, { type: 'create-lobby-room' }>,
): LobbyDecision => {
  const { lobby, room } = facts;
  if (lobby === null) return refuse('not-found');
  if (lobby.closedAt !== null) return refuse('lobby-closed');
  if (lobby.kind !== 'standing') return refuse('lobby-not-standing');
  const template =
    command.templateId === null
      ? null
      : room.offeredTemplates.find(
          (offered) => offered.id === command.templateId,
        );
  if (template === undefined) return refuse('template-not-offered');
  if (template === null && room.ownFormat === 'off')
    return refuse('template-required');
  if (
    template !== null &&
    !selectsTemplateFormat(command.room.selection, template)
  )
    return refuse('template-format-mismatch');
  if (
    room.enforcedVisibility !== null &&
    room.enforcedVisibility !== command.room.visibility
  )
    return refuse('setting-enforced');
  if (command.room.resolution.kind === 'custom' && room.ownText === 'off')
    return refuse('pool-resolution-required');
  return accepted({ kind: 'lobby', id: lobby.id }, lobby.version, [
    {
      table: 'rooms',
      op: 'insert',
      row: {
        id: facts.newId,
        lobbyId: lobby.id,
        lobbyKind: 'standing',
        templateId: template?.id ?? null,
        ballotDefinitionId: template?.ballotDefinitionId ?? null,
        ballotDefinitionVersion: template?.ballotDefinitionVersion ?? null,
      },
      create: command.room,
    },
  ]);
};

/** Decides one lobby, season or ladder command, or a standing lobby's Room. */
export const decideLobby = (
  facts: LobbyFacts,
  command: LobbyCommand,
): LobbyDecision => {
  switch (command.type) {
    case 'create-lobby':
      return createLobby(facts, command);
    case 'update-lobby':
      return updateLobby(facts, command);
    case 'set-tournament-status':
      return setTournamentStatus(facts, command);
    case 'close-lobby':
      return closeLobby(facts);
    case 'create-season':
      return createSeason(facts, command);
    case 'close-season':
      return closeSeason(facts, command);
    case 'set-ladder':
      return setLadder(facts, command);
    case 'create-lobby-room':
      return createLobbyRoom(facts, command);
  }
};
