import { lobbyKinds } from '@daisy/protocol/lobby';
import { listedWord } from './lifecycle-sql';
import { isMinorAgeBand } from './guardians/lobby-permissions';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomParticipant,
} from '@daisy/protocol/room-contract';
import type { FormatDefinition } from '@daisy/protocol/format';
import type { AiRole } from '@daisy/protocol/ai-roles';
import { buildRoomTopic } from '@daisy/protocol/topics';
import { botDifficulties } from '@daisy/protocol/room-read';
import { idSchema } from '@daisy/protocol/primitives';
import { roomRoundLinkOf } from '@daisy/protocol/room-contract';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  authorizationAccountFact,
  authorizationAccountRow,
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';
import { appendOutboxEvent } from './outbox';

import { actors } from './schema/actors';
import { basisSource } from './room-basis';
import { users } from './schema/users';
import { accountAge } from './schema/account-age';
import type { AgeBand } from '@daisy/protocol/ladder';
import { lobbies } from './schema/lobbies';
import { lobbyAgeRules } from '@daisy/protocol/lobby/eligibility';
import { divisionAgeBand } from './ladder-division-band';
import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';
import { aiSeatFits } from '@daisy/protocol/seat-eligibility';
import { seatOfColumns, seatRowOrder } from './seat-columns';
import { roomCommands } from './schema/room-commands';
import { rooms, roomParticipants, roomSeatHolds } from './schema/rooms';
import { rounds } from './schema/rounds';

import { formats } from './schema/formats';
import { formatRevisions } from './schema/format-revisions';
import type { Tx } from './tx';
import { takeLock, transactionLocks } from './locks';
import { parsedColumn, query } from './raw-rows';
import { z } from 'zod';

export type Caller = { readonly userId: string; readonly actorId: string };
export type Account = ReturnType<typeof authorizationAccountFact>;
export type AuthorizeRoom = (
  state: RoomAssemblyState,
  account: Account,
  direction?: import('./tab/room-direction').RoomDirectionInput | null,
  now?: string,
) => boolean;
export const lockedAccount = async (
  tx: Tx,
  caller: Caller,
): Promise<Account> => {
  await lockAuthorizationActors(tx, [caller.actorId], { maxActors: 1 });
  return loadAuthorizationAccount(tx, caller.userId);
};
export const requireAccount = async (
  tx: Tx,
  caller: Caller,
  authorize: (account: Account) => boolean,
) => {
  const account = await sharedAccount(tx, caller);
  if (!authorize(account)) throw createAppError('AUTHORIZATION');
  return account;
};
/** Standalone reads only: never upgrade this compatible reader fence to a writer fence. */
export const sharedAccount = async (
  tx: Tx,
  caller: Caller,
): Promise<Account> => {
  if (
    !idSchema.safeParse(caller.userId).success ||
    !idSchema.safeParse(caller.actorId).success
  )
    throw createAppError('VALIDATION');
  const rows = await query(
    tx,
    authorizationAccountRow,
    sql`select * from public.daisy_room_read_account_v2(${caller.actorId}::text, ${caller.userId}::text)`,
  );
  return authorizationAccountFact(rows[0] ?? null);
};
export type Actor = {
  readonly guardianLobbyIds?: readonly string[] | undefined;
  readonly actorId: string;
  readonly kind: RoomParticipant['kind'];
  readonly label: string;
  readonly eligible: boolean;
  /** Competition age band; null for a bot or a missing age record. */
  readonly ageBand: AgeBand | null;
  /** Which AI the actor is (ISSUE-750); null for a human. */
  readonly aiRole: AiRole | null;
  /** The roster card's display facts; present for bot debaters only. */
  readonly persona?: string;
  readonly difficulty?: (typeof botDifficulties)[number];
};
/** An AI actor is a bot debater or the AI judge by its profile, never both (ISSUE-750). */
const aiRoleOf = (
  botName: string | null,
  judgeName: string | null,
): AiRole | null => {
  if (botName !== null && judgeName === null) return 'debater';
  if (judgeName !== null && botName === null) return 'judge';
  return null;
};
export const actorFact = async (
  tx: Tx,
  actorId: string,
  eligibility?: {
    readonly lobbyId: string;
    readonly readPermissions: (userId: string) => Promise<readonly string[]>;
  },
): Promise<Actor | null> => {
  const [row] = await tx
    .select({
      actorId: actors.id,
      kind: actors.kind,
      username: users.username,
      deletedAt: users.deletedAt,
      verified: users.emailVerified,
      botName: botProfiles.name,
      judgeName: aiJudgeProfiles.name,
      ageBand: divisionAgeBand(eligibility?.lobbyId),
      ...(eligibility ? { userId: actors.userId } : {}),
    })
    .from(actors)
    .leftJoin(users, eq(users.id, actors.userId))
    .leftJoin(accountAge, eq(accountAge.userId, actors.userId))
    .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
    .leftJoin(aiJudgeProfiles, eq(aiJudgeProfiles.actorId, actors.id))
    .where(eq(actors.id, actorId));
  if (!row) return null;
  if (row.kind === 'human')
    return {
      actorId: row.actorId,
      kind: row.kind,
      label: row.username ?? '',
      eligible:
        row.verified === true &&
        row.username !== null &&
        row.deletedAt === null,
      ageBand: row.ageBand,
      ...(eligibility && row.userId && isMinorAgeBand(row.ageBand)
        ? { guardianLobbyIds: await eligibility.readPermissions(row.userId) }
        : {}),
      aiRole: null,
    };
  const aiRole = aiRoleOf(row.botName, row.judgeName);
  return {
    actorId: row.actorId,
    kind: row.kind,
    label: row.botName ?? row.judgeName ?? '',
    eligible: aiRole !== null,
    ageBand: null,
    aiRole,
  };
};
export const publishDefinition = async (
  tx: Tx,
  id: string,
  hostActorId: string | null,
  definition: FormatDefinition,
) => {
  await tx
    .insert(formatRevisions)
    .values({ formatId: id, version: 1, definition });
  await tx.insert(formats).values({
    id,
    name: 'Custom format',
    currentVersion: 1,
    createdByActorId: hostActorId,
  });
};
/** The Room's state and its draw seed (hex), for settlement; never delivered. */
export const roomFacts = async (
  tx: Tx,
  row: typeof rooms.$inferSelect,
): Promise<{ readonly state: RoomAssemblyState }> => ({
  state: await hydrateRoom(tx, row),
});

/**
 * The Room's state for a command or an expiry, which may write it back. A read
 * joins the stored status to the Round row and never fails on one that
 * disagrees (`roomRoundLinkOf`); a participant's command and the expiry sweep
 * refuse such a Room instead, loudly, so a status the read reconciled is never
 * stored as if it had been decided. Erasure and a restriction still act on it.
 */
export const roomFactsForWrite = async (
  tx: Tx,
  row: typeof rooms.$inferSelect,
): Promise<{ readonly state: RoomAssemblyState }> => {
  const facts = await roomFacts(tx, row);
  if (facts.state.status !== row.status)
    throw createAppError(
      'INVARIANT',
      'A Room status disagrees with its Round row',
    );
  return facts;
};

const hydrateRoom = async (
  tx: Tx,
  row: typeof rooms.$inferSelect,
): Promise<RoomAssemblyState> => {
  const [revision] = await tx
    .select({
      definition: formatRevisions.definition,
      name: formats.name,
      role: formats.catalogRole,
      leagues: formats.leagues,
    })
    .from(formatRevisions)
    .innerJoin(formats, eq(formats.id, formatRevisions.formatId))
    .where(
      and(
        eq(formatRevisions.formatId, row.formatId),
        eq(formatRevisions.version, row.formatVersion),
      ),
    );
  if (!revision) throw createAppError('INVARIANT');
  const basis = await basisSource(tx, row);
  const seats = await tx
    .select()
    .from(roomParticipants)
    .where(eq(roomParticipants.roomId, row.id))
    .orderBy(...seatRowOrder(roomParticipants));
  const standingParent = alias(lobbies, 'standing_parent');
  const [lobby] = await tx
    .select({
      // Room chat projects frozen and mixed-cast tournament privacy from this view.
      ageRule: parsedColumn(
        z.enum(lobbyAgeRules),
        sql`case
        when ${row.legacyTournamentYouth === false}::boolean then 'adults'::lobby_age_rule
        when ${lobbies.kind} = ${listedWord(lobbyKinds, 'tournament')} and public.daisy_room_is_youth(${row.id})
          then 'under-18'::lobby_age_rule
        else coalesce(
          (select round.standing_age_rule from public.rounds round
            where round.room_id = ${row.id} and ${lobbies.kind} = ${listedWord(lobbyKinds, 'tournament')}),
          ${standingParent.ageRule}, ${lobbies.ageRule}) end`,
      ),
    })
    .from(lobbies)
    .leftJoin(standingParent, eq(standingParent.id, lobbies.standingLobbyId))
    .where(eq(lobbies.id, row.lobbyId));
  if (!lobby) throw createAppError('INVARIANT');
  const participants = await Promise.all(
    seats.map(async (row) => {
      const actor = await actorFact(tx, row.actorId);
      if (!actor) throw createAppError('INVARIANT');
      const seat = seatOfColumns(row);
      return {
        ...actor,
        // A seating made before ISSUE-750 cannot launch in the wrong kind of seat.
        eligible:
          actor.eligible &&
          (actor.kind === 'human' || aiSeatFits(actor.aiRole, seat)),
        id: row.id,
        seat,
        teamOpen: row.teamOpen,
        positionOpen: row.positionOpen,
        consentCommandId: row.readinessCommandId,
        consentVersion: row.readinessVersion,
      };
    }),
  );
  const hostActorId = hostPersonOf(row);
  const host = hostActorId === null ? null : await actorFact(tx, hostActorId);
  const [round] = await tx
    .select({
      id: rounds.id,
      status: rounds.status,
      resolution: rounds.resolution,
    })
    .from(rounds)
    .where(eq(rounds.roomId, row.id));
  const seatHolds = await tx
    .select({
      actorId: roomSeatHolds.actorId,
      seat: roomSeatHolds.seat,
      until: roomSeatHolds.until,
    })
    .from(roomSeatHolds)
    .where(eq(roomSeatHolds.roomId, row.id));
  return {
    id: row.id,
    version: row.version,
    changeVersion: row.changeVersion,
    seatHolds: seatHolds.map((hold) => ({
      actorId: hold.actorId,
      seat: hold.seat,
      until: new Date(hold.until).toISOString(),
    })),
    title: row.title,
    // A draw Room's resolution is its Round's, once revealed.
    topic: round?.resolution ?? row.topic,
    visibility: row.visibility,
    hostActorId,
    hostInherited: row.hostInherited,
    hostLabel: host?.label ?? '',
    formatId: row.formatId,
    formatVersion: row.formatVersion,
    presetVersion: row.presetVersion,
    catalogFormat: {
      name: revision.name,
      role: revision.role,
      leagues: revision.leagues,
    },
    basis,
    competitionType: row.competitionType,
    lobbyId: row.lobbyId,
    ageRule: lobby.ageRule,
    capture: row.capture,
    postRoundCall: row.postRoundCall,
    teamOneSide: row.teamOneSide,
    holdsHost: row.holdsHost,
    definition: revision.definition,
    config: row.config,
    executionPlan: row.executionPlan,
    rules: row.rulesSnapshot,
    participants,
    ...roomRoundLinkOf(
      row.status,
      round ? { id: round.id, status: round.status } : null,
    ),
  };
};
export const lockCommand = (tx: Tx, commandId: string) =>
  takeLock(tx, transactionLocks.roomCommand(commandId));
export const replayReceipt = async (
  tx: Tx,
  commandId: string,
  actorId: string,
  payloadDigest: string,
  roomId?: string,
): Promise<RoomCommandReceipt | null> => {
  const [previous] = await tx
    .select()
    .from(roomCommands)
    .where(eq(roomCommands.commandId, commandId));
  if (!previous) return null;
  if (
    previous.actorId !== actorId ||
    previous.payloadDigest !== payloadDigest ||
    (roomId !== undefined && previous.roomId !== roomId)
  )
    throw createRefusal('CONFLICT', 'command-conflict');
  return {
    ...(previous.result as Omit<RoomCommandReceipt, 'replayed'>),
    replayed: true,
  };
};
export const acceptCommand = async (
  tx: Tx,
  receipt: RoomCommandReceipt,
  actorId: string,
  payloadDigest: string,
  type: string,
  now: string,
  changeVersion: number,
) => {
  const { replayed: _replayed, ...result } = receipt;
  void _replayed;
  await tx.insert(roomCommands).values({
    commandId: receipt.commandId,
    roomId: receipt.roomId,
    actorId,
    payloadDigest,
    type,
    result,
    resultingVersion: receipt.resultingVersion,
    appliedAt: new Date(now),
  });
  await appendRoomChanged(tx, receipt.roomId, changeVersion);
};
/** The content-free invalidation for a Room change, accepted command or not. */
export const appendRoomChanged = (
  tx: Tx,
  roomId: string,
  changeVersion: number,
) =>
  appendOutboxEvent(tx, {
    topic: buildRoomTopic(roomId),
    kind: 'room.changed',
    version: 1,
    payload: {
      kind: 'room.changed',
      entityVersion: changeVersion,
      ids: [roomId],
    },
  });
export const transactionNow = async (tx: Tx): Promise<string> => {
  const [row] = await query(
    tx,
    z.object({ now: z.date() }),
    sql`select statement_timestamp() as now`,
  );
  if (!row) throw createAppError('INFRASTRUCTURE');
  return new Date(row.now).toISOString();
};

/**
 * The host person of a Room, or null for a Room no person hosts (TAB-6). A
 * Room in a standing lobby has a host; one in a tournament lobby has none
 * (`rooms_host_by_lobby_kind`): authority over it comes from grants on the
 * lobby, and the engine refuses its host-only commands. A row whose host
 * disagrees with its lobby's kind is corruption, refused here rather than
 * read as either kind of Room.
 */
export const hostPersonOf = (room: {
  readonly id: string;
  readonly hostActorId: string | null;
  readonly lobbyKind: 'standing' | 'tournament';
}): string | null => {
  if ((room.hostActorId === null) !== (room.lobbyKind === 'tournament'))
    throw createAppError(
      'INVARIANT',
      `Room ${room.id} has a host exactly when its lobby is standing`,
    );
  return room.hostActorId;
};
