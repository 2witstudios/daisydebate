import { discoverRooms, type RoomDiscoveryFact } from './room-discovery';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  roomListQuerySchema,
  type RoomListQuery,
  type RoomListPage,
} from '@daisy/protocol';
import { currentFormatRevisions } from './format-operations';
import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  LaunchedRound,
  RoundView,
  RoomAssemblyState,
  RoomCommandReceipt,
} from '@daisy/protocol';

import { createAppError } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';

import { botProfiles } from './schema/bot-profiles';

import { rooms } from './schema/rooms';
import { rounds } from './schema/rounds';
import { segmentRows } from './round-hydration';
import { recordedUnjudgedRuling } from './round-unjudged-decisions';
import { roundCommands } from './schema/round-commands';
import { readableCheckpoint, roundViewFor } from './round-view-projection';
import { roundParticipants } from './schema/round-participants';
import { formats } from './schema/formats';

import { formatPresets } from './schema/format-presets';

import {
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  lockedAccount,
  sharedAccount,
  requireAccount,
  actorFact,
  roomFacts,
  lockCommand,
  replayReceipt,
} from './room-command-facts';
export async function launchedRoundRows(
  tx: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
): Promise<LaunchedRound> {
  const [row] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('share');
  if (!row || !row.roomId || !row.roomConfigSnapshot || !row.visibility)
    throw createAppError('NOT_FOUND');
  const seats = await tx
    .select()
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
  const participants = await Promise.all(
    seats.map(async (p) => {
      const actor = await actorFact(tx, p.actorId);
      if (!actor) throw createAppError('INVARIANT');
      return {
        id: p.id,
        actorId: actor.actorId,
        kind: actor.kind,
        label: actor.label,
        role: p.role,
        slot: p.slot,
      };
    }),
  );
  const round: LaunchedRound = {
    id: row.id,
    roomId: row.roomId,
    version: row.version,
    status: row.status,
    competitionType: row.competitionType,
    topic: row.resolution,
    visibility: row.visibility,
    hostActorId: row.createdByActorId,
    config: row.roomConfigSnapshot,
    rules: row.rulesSnapshot,
    participants,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    outcome: row.outcome,
    unjudgedRuling: recordedUnjudgedRuling(
      await tx
        .select()
        .from(roundCommands)
        .where(
          and(
            eq(roundCommands.roundId, roundId),
            eq(roundCommands.type, 'complete'),
          ),
        ),
    ),
    checkpoint: readableCheckpoint(row.runtimeState),
    segments: await segmentRows(tx, roundId),
  };
  return round;
}
export const roomReadOperations = ({
  database,
  eventSink,
  commandTransaction,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  async readLaunchedRound(
    roundId: string,
    caller: Caller,
    authorize: (round: LaunchedRound, account: Account) => boolean,
  ): Promise<RoundView> {
    return instrumented(eventSink, 'readLaunchedRound', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const round = await launchedRoundRows(tx, roundId);
        if (!authorize(round, account)) throw createAppError('NOT_FOUND');
        return roundViewFor(round, caller.actorId);
      }),
    );
  },
  async listRoomCatalogSources(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ) {
    return instrumented(eventSink, 'listRoomCatalogSources', () =>
      database.transaction(async (tx) => {
        await requireAccount(tx, caller, authorize);
        const rows = await currentFormatRevisions(tx).where(
          isNull(formats.createdByActorId),
        );
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
    return (await this.readRoomAssemblyFacts(roomId, caller, authorize)).state;
  },
  /** The Room and its draw seed in one read; the seed settles projections and never leaves the server. */
  async readRoomAssemblyFacts(
    roomId: string,
    caller: Caller,
    authorize: AuthorizeRoom,
  ): Promise<{
    readonly state: RoomAssemblyState;
    readonly drawSeed: string | null;
  }> {
    return instrumented(eventSink, 'readRoomAssembly', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .for('share');
        if (!row) throw createAppError('NOT_FOUND');
        const facts = await roomFacts(tx, row);
        if (!authorize(facts.state, account)) throw createAppError('NOT_FOUND');
        return facts;
      }),
    );
  },
  async listRoomPage(
    caller: Caller,
    query: RoomListQuery,
    authorize: (fact: RoomDiscoveryFact, account: Account) => boolean,
    authorizeCollection: (account: Account) => boolean,
    hostHidden: (fact: RoomDiscoveryFact) => boolean,
  ): Promise<RoomListPage> {
    if (!roomListQuerySchema.safeParse(query).success)
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'listRoomPage', () =>
      database.transaction((tx) =>
        discoverRooms(
          tx,
          caller,
          query,
          authorize,
          authorizeCollection,
          hostHidden,
        ),
      ),
    );
  },
  async listRoomBots(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<readonly Actor[]> {
    return instrumented(eventSink, 'listRoomBots', () =>
      database.transaction(async (tx) => {
        await requireAccount(tx, caller, authorize);
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
  async readRoomCreateReceipt(input: {
    readonly caller: Caller;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly authorize: (account: Account) => boolean;
  }): Promise<RoomCommandReceipt | null> {
    return instrumented(eventSink, 'readRoomCreateReceipt', () =>
      commandTransaction(async (tx) => {
        await lockCommand(tx, input.commandId);
        const account = await lockedAccount(tx, input.caller);
        if (!input.authorize(account)) throw createAppError('AUTHORIZATION');
        return replayReceipt(
          tx,
          input.commandId,
          input.caller.actorId,
          input.payloadDigest,
        );
      }),
    );
  },
});
