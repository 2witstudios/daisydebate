import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
  RoomParticipant,
  FormatDefinition,
} from '@daisy/protocol';
import { buildRoomTopic } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { authorizationAccountFact } from './authorization-account';
import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';
import { appendOutboxEvent } from './outbox';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';
import { users } from './schema/users';
import { botProfiles } from './schema/bot-profiles';
import { roomCommands } from './schema/room-commands';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { formats } from './schema/formats';
import { formatRevisions } from './schema/format-revisions';
import { formatPresets } from './schema/format-presets';
import { newRoomValues, type NewRoom } from './room-operations';

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
type Caller = { readonly userId: string; readonly actorId: string };
type Account = ReturnType<typeof authorizationAccountFact>;
type AuthorizeRoom = (state: RoomAssemblyState, account: Account) => boolean;
const lockedAccount = async (tx: Tx, caller: Caller): Promise<Account> => {
  await lockAuthorizationActors(tx, [caller.actorId]);
  return loadAuthorizationAccount(tx, caller.userId);
};
type Actor = {
  readonly actorId: string;
  readonly kind: RoomParticipant['kind'];
  readonly label: string;
  readonly eligible: boolean;
};
const actorFact = async (tx: Tx, actorId: string): Promise<Actor | null> => {
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
const publishDefinition = async (
  tx: Tx,
  id: string,
  hostActorId: string,
  definition: FormatDefinition,
) => {
  await tx
    .insert(formatRevisions)
    .values({ formatId: id, version: 1, definition });
  await tx
    .insert(formats)
    .values({
      id,
      name: 'Custom format',
      currentVersion: 1,
      createdByActorId: hostActorId,
    });
};
const roomState = async (
  tx: Tx,
  row: typeof rooms.$inferSelect,
): Promise<RoomAssemblyState> => {
  const [revision] = await tx
    .select({ definition: formatRevisions.definition })
    .from(formatRevisions)
    .where(
      and(
        eq(formatRevisions.formatId, row.formatId),
        eq(formatRevisions.version, row.formatVersion),
      ),
    );
  if (!revision) throw createAppError('INVARIANT');
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
    competitionType: row.competitionType,
    length: row.length,
    definition: revision.definition,
    config: row.config,
    executionPlan: row.executionPlan,
    rules: row.rulesSnapshot,
    participants,
    prepStartedAt: row.prepStartedAt?.toISOString() ?? null,
    prepRemainingMs: row.prepRemainingMs,
    roundRef: round ?? null,
  };
};
const lockCommand = (tx: Tx, commandId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId}, 59001))`,
  );
const replayReceipt = async (
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
const acceptCommand = async (
  tx: Tx,
  receipt: RoomCommandReceipt,
  actorId: string,
  payloadDigest: string,
  type: string,
  now: string,
  changeVersion: number,
) => {
  const { replayed: _replayed, ...result } = receipt;
  await tx
    .insert(roomCommands)
    .values({
      commandId: receipt.commandId,
      roomId: receipt.roomId,
      actorId,
      payloadDigest,
      type,
      result,
      resultingVersion: receipt.resultingVersion,
      appliedAt: new Date(now),
    });
  await appendOutboxEvent(tx, {
    topic: buildRoomTopic(receipt.roomId),
    kind: 'room.changed',
    version: 1,
    payload: {
      kind: 'room.changed',
      entityVersion: changeVersion,
      ids: [receipt.roomId],
    },
  });
};
const transactionNow = async (tx: Tx): Promise<string> => {
  const [row] = (await tx.execute(
    sql`select statement_timestamp() as now`,
  )) as unknown as Array<{ now: Date }>;
  if (!row) throw createAppError('INFRASTRUCTURE');
  return new Date(row.now).toISOString();
};

/** Canonical command adapter. Every accepted Room effect and its one doorbell commit together. */
export const roomCommandOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async listRoomCatalogSources(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ) {
    return instrumented(eventSink, 'listRoomCatalogSources', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
        if (!authorize(account)) throw createAppError('AUTHORIZATION');
        const rows = await tx
          .select({
            id: formats.id,
            name: formats.name,
            version: formats.currentVersion,
            definition: formatRevisions.definition,
          })
          .from(formats)
          .innerJoin(
            formatRevisions,
            and(
              eq(formatRevisions.formatId, formats.id),
              eq(formatRevisions.version, formats.currentVersion),
            ),
          )
          .where(isNull(formats.createdByActorId));
        const presets = await tx
          .select()
          .from(formatPresets)
          .where(isNull(formatPresets.supersededAt));
        return rows.map((row) => ({
          ...row,
          presets: presets.filter(
            (p) => p.formatId === row.id && p.formatVersion === row.version,
          ),
        }));
      }),
    );
  },
  async readRoomAssembly(
    roomId: string,
    caller: Caller,
    authorize: AuthorizeRoom,
  ): Promise<RoomAssemblyState> {
    return instrumented(eventSink, 'readRoomAssembly', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .for('share');
        if (!row) throw createAppError('NOT_FOUND');
        const state = await roomState(tx, row);
        if (!authorize(state, account)) throw createAppError('NOT_FOUND');
        return state;
      }),
    );
  },
  async listRoomAssemblies(
    caller: Caller,
    authorize: AuthorizeRoom,
  ): Promise<readonly RoomAssemblyState[]> {
    return instrumented(eventSink, 'listRoomAssemblies', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
        const rows = await tx
          .select()
          .from(rooms)
          .where(
            or(
              eq(rooms.visibility, 'public'),
              eq(rooms.hostActorId, caller.actorId),
            ),
          )
          .for('share');
        const states = await Promise.all(rows.map((row) => roomState(tx, row)));
        return states.filter((state) => authorize(state, account));
      }),
    );
  },
  async listRoomBots(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<readonly Actor[]> {
    return instrumented(eventSink, 'listRoomBots', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
        if (!authorize(account)) throw createAppError('AUTHORIZATION');
        const rows = await tx
          .select({ id: actors.id })
          .from(actors)
          .innerJoin(botProfiles, eq(botProfiles.actorId, actors.id))
          .where(eq(actors.kind, 'bot'));
        const bots = await Promise.all(
          rows.map((row) => actorFact(tx, row.id)),
        );
        return bots.filter((bot): bot is Actor => bot !== null);
      }),
    );
  },
  async createRoomCommand(input: {
    readonly room: NewRoom;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly definition: FormatDefinition | null;
    readonly caller: Caller;
    readonly authorize: (account: Account) => boolean;
  }): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'createRoomCommand', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, input.caller);
        if (
          input.caller.actorId !== input.room.hostActorId ||
          !input.authorize(account)
        )
          throw createAppError('AUTHORIZATION');
        await lockCommand(tx, input.commandId);
        const replay = await replayReceipt(
          tx,
          input.commandId,
          input.room.hostActorId,
          input.payloadDigest,
        );
        if (replay) return replay;
        // Serialize the adopted five-open-Room cap for a host, across instances.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.room.hostActorId}, 59002))`,
        );
        const [count] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(rooms)
          .where(
            and(
              eq(rooms.hostActorId, input.room.hostActorId),
              sql`${rooms.status} in ('assembling', 'ready')`,
            ),
          );
        if (Number(count?.count ?? 0) >= 5) throw createAppError('RATE_LIMIT');
        if (input.definition)
          await publishDefinition(
            tx,
            input.room.formatId,
            input.room.hostActorId,
            input.definition,
          );
        const now = await transactionNow(tx);
        await tx
          .insert(rooms)
          .values({
            ...newRoomValues(input.room, 'assembling'),
            createdAt: new Date(now),
            updatedAt: new Date(now),
          });
        const receipt: RoomCommandReceipt = {
          commandId: input.commandId,
          roomId: input.room.id,
          resultingVersion: 1,
          roundRef: null,
          replayed: false,
        };
        await acceptCommand(
          tx,
          receipt,
          input.room.hostActorId,
          input.payloadDigest,
          'create',
          now,
          1,
        );
        return receipt;
      }),
    );
  },
  async executeRoomCommand(input: {
    readonly caller: Caller;
    readonly authorizeRead: AuthorizeRoom;
    readonly roomId: string;
    readonly actorId: string;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly type: string;
    readonly targetActorId: string | null;
    readonly roundId: string;
    readonly execute: (
      state: RoomAssemblyState,
      now: string,
      target: Actor | null,
      account: Account,
    ) => Promise<RoomMutationOutcome>;
  }): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'executeRoomCommand', () =>
      database.transaction(async (tx) => {
        const initialSeats = await tx
          .select({ actorId: roomParticipants.actorId })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, input.roomId));
        const fencedActors = [
          ...new Set([
            input.caller.actorId,
            ...initialSeats.map((p) => p.actorId),
            ...(input.targetActorId ? [input.targetActorId] : []),
          ]),
        ];
        await lockAuthorizationActors(tx, fencedActors);
        const account = await loadAuthorizationAccount(tx, input.caller.userId);
        if (input.caller.actorId !== input.actorId)
          throw createAppError('AUTHORIZATION');
        await lockCommand(tx, input.commandId);
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for('update');
        if (!row) throw createAppError('NOT_FOUND');
        const state = await roomState(tx, row);
        if (!input.authorizeRead(state, account))
          throw createAppError('NOT_FOUND');
        if (state.participants.some((p) => !fencedActors.includes(p.actorId)))
          throw createAppError(
            'CONFLICT',
            'Cast changed while acquiring authority',
          );
        const replay = await replayReceipt(
          tx,
          input.commandId,
          input.actorId,
          input.payloadDigest,
          input.roomId,
        );
        if (replay) return replay;
        const now = await transactionNow(tx);
        const target = input.targetActorId
          ? await actorFact(tx, input.targetActorId)
          : null;
        const outcome = await input.execute(state, now, target, account);
        if (!outcome.ok)
          throw createAppError(
            outcome.refusal === 'host-required'
              ? 'AUTHORIZATION'
              : outcome.refusal === 'readiness-unavailable'
                ? 'INFRASTRUCTURE'
                : 'CONFLICT',
            outcome.refusal,
          );
        const next = outcome.mutation.state;
        if (outcome.mutation.publishDefinition)
          await publishDefinition(
            tx,
            next.formatId,
            next.hostActorId,
            next.definition,
          );
        // Row lock prevents readers or other commands observing partial cast/prep/config.
        await tx
          .update(rooms)
          .set({
            title: next.title,
            topic: next.topic,
            visibility: next.visibility,
            version: next.version,
            changeVersion: next.changeVersion,
            formatId: next.formatId,
            formatVersion: next.formatVersion,
            config: next.config,
            executionPlan: next.executionPlan,
            rulesSnapshot: next.rules,
            status: next.status,
            prepStartedAt: next.prepStartedAt
              ? new Date(next.prepStartedAt)
              : null,
            prepRemainingMs: next.prepRemainingMs,
            updatedAt: new Date(now),
          })
          .where(eq(rooms.id, next.id));
        await tx
          .delete(roomParticipants)
          .where(eq(roomParticipants.roomId, next.id));
        if (next.participants.length)
          await tx
            .insert(roomParticipants)
            .values(
              next.participants.map((p) => ({
                id: p.id,
                roomId: next.id,
                actorId: p.actorId,
                role: p.role,
                slot: p.slot,
                readinessCommandId: p.consentCommandId,
                readinessVersion: p.consentVersion,
              })),
            );
        let roundRef = next.roundRef;
        if (outcome.mutation.freeze) {
          await tx
            .insert(rounds)
            .values({
              id: input.roundId,
              roomId: next.id,
              createdByActorId: next.hostActorId,
              resolution: next.topic,
              competitionType: next.competitionType,
              length: next.length,
              formatId: next.formatId,
              formatVersion: next.formatVersion,
              presetVersion: next.presetVersion,
              roomConfigSnapshot: next.config,
              rulesSnapshot: next.rules,
              status: 'scheduled',
              ladderId:
                next.competitionType === 'ranked'
                  ? next.length === 'full'
                    ? 'ranked'
                    : 'quick'
                  : null,
              createdAt: new Date(now),
              updatedAt: new Date(now),
            });
          await tx
            .insert(roundParticipants)
            .values(
              next.participants.map((p) => ({
                id: p.id,
                roundId: input.roundId,
                actorId: p.actorId,
                role: p.role,
                slot: p.slot,
              })),
            );
          roundRef = { id: input.roundId, status: 'scheduled' };
        }
        const receipt: RoomCommandReceipt = {
          commandId: input.commandId,
          roomId: next.id,
          resultingVersion: next.version,
          roundRef,
          replayed: false,
        };
        await acceptCommand(
          tx,
          receipt,
          input.actorId,
          input.payloadDigest,
          input.type,
          now,
          next.changeVersion,
        );
        return receipt;
      }),
    );
  },
});
