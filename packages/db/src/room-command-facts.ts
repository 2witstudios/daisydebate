import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomParticipant,
  FormatDefinition,
} from '@daisy/protocol';
import { buildRoomTopic } from '@daisy/protocol';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { authorizationAccountFact } from './authorization-account';
import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';
import { appendOutboxEvent } from './outbox';

import { actors } from './schema/actors';
import { basisSource } from './room-basis';
import { users } from './schema/users';
import { botProfiles } from './schema/bot-profiles';
import { roomCommands } from './schema/room-commands';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';

import { formats } from './schema/formats';
import { formatRevisions } from './schema/format-revisions';
import { loadRoomDraw } from './room-draw-persistence';

export type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
export type Caller = { readonly userId: string; readonly actorId: string };
export type Account = ReturnType<typeof authorizationAccountFact>;
export type AuthorizeRoom = (
  state: RoomAssemblyState,
  account: Account,
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
  tx: Pick<Tx, 'execute'>,
  caller: Caller,
): Promise<Account> => {
  if (
    !idSchema.safeParse(caller.userId).success ||
    !idSchema.safeParse(caller.actorId).success
  )
    throw createAppError('VALIDATION');
  const rows = await tx.execute(
    sql`select * from public.daisy_room_read_account_v2(${caller.actorId}::text, ${caller.userId}::text)`,
  );
  return authorizationAccountFact(
    (rows as unknown as Parameters<typeof authorizationAccountFact>[0][])[0] ??
      null,
  );
};
export type Actor = {
  readonly actorId: string;
  readonly kind: RoomParticipant['kind'];
  readonly label: string;
  readonly eligible: boolean;
};
export const actorFact = async (
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<Actor | null> => {
  const [row] = await tx
    .select({
      actorId: actors.id,
      kind: actors.kind,
      username: users.username,
      deletedAt: users.deletedAt,
      verified: users.emailVerified,
      botName: botProfiles.name,
    })
    .from(actors)
    .leftJoin(users, eq(users.id, actors.userId))
    .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
    .where(eq(actors.id, actorId));
  if (!row || (row.kind !== 'human' && row.kind !== 'bot')) return null;
  return {
    actorId: row.actorId,
    kind: row.kind,
    label: row.kind === 'bot' ? (row.botName ?? '') : (row.username ?? ''),
    eligible:
      row.kind === 'bot'
        ? row.botName !== null
        : row.verified === true &&
          row.username !== null &&
          row.deletedAt === null,
  };
};
export const publishDefinition = async (
  tx: Tx,
  id: string,
  hostActorId: string,
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
): Promise<{
  readonly state: RoomAssemblyState;
  readonly drawSeed: string | null;
}> => {
  const state = await hydrateRoom(tx, row);
  const draw = await loadRoomDraw(tx, row.id);
  return {
    state: { ...state, resolutionDraw: draw?.state ?? null },
    drawSeed: draw?.seed ?? null,
  };
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
    .where(eq(roomParticipants.roomId, row.id));
  const participants = await Promise.all(
    seats.map(async (seat) => {
      const actor = await actorFact(tx, seat.actorId);
      if (!actor) throw createAppError('INVARIANT');
      return {
        ...actor,
        id: seat.id,
        role: seat.role,
        slot: seat.slot,
        consentCommandId: seat.readinessCommandId,
        consentVersion: seat.readinessVersion,
      };
    }),
  );
  const host = await actorFact(tx, row.hostActorId);
  const [round] = await tx
    .select({ id: rounds.id, status: rounds.status })
    .from(rounds)
    .where(eq(rounds.roomId, row.id));
  return {
    id: row.id,
    version: row.version,
    changeVersion: row.changeVersion,
    title: row.title,
    topic: row.topic,
    visibility: row.visibility,
    hostActorId: row.hostActorId,
    hostLabel: host?.label ?? '',
    status: row.status,
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
    definition: revision.definition,
    config: row.config,
    executionPlan: row.executionPlan,
    rules: row.rulesSnapshot,
    participants,
    prepStartedAt: row.prepStartedAt?.toISOString() ?? null,
    prepRemainingMs: row.prepRemainingMs,
    resolutionDraw: null,
    roundRef: round ?? null,
  };
};
export const lockCommand = (tx: Tx, commandId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId}, 59001))`,
  );
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
    throw createAppError('CONFLICT', 'command-conflict');
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
  const [row] = (await tx.execute(
    sql`select statement_timestamp() as now`,
  )) as unknown as Array<{ now: Date }>;
  if (!row) throw createAppError('INFRASTRUCTURE');
  return new Date(row.now).toISOString();
};
