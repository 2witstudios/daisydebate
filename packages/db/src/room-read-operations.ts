import { currentFormatRevisions } from './format-operations';
import { eq, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
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
import { roundParticipants } from './schema/round-participants';
import { formats } from './schema/formats';

import { formatPresets } from './schema/format-presets';

import {
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  lockedAccount,
  requireAccount,
  actorFact,
  roomState,
  lockCommand,
  replayReceipt,
} from './room-command-facts';
export const roomReadOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async readLaunchedRound(
    roundId: string,
    caller: Caller,
    authorize: (view: RoundView, account: Account) => boolean,
  ): Promise<RoundView> {
    return instrumented(eventSink, 'readLaunchedRound', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
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
        const view: RoundView = {
          id: row.id,
          roomId: row.roomId,
          version: row.version,
          status: row.status,
          topic: row.resolution,
          visibility: row.visibility,
          hostActorId: row.createdByActorId,
          config: row.roomConfigSnapshot,
          rules: row.rulesSnapshot,
          participants,
          startedAt: row.startedAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          outcome: row.outcome,
        };
        if (!authorize(view, account)) throw createAppError('NOT_FOUND');
        return view;
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
    authorizeCollection: (account: Account) => boolean,
  ): Promise<readonly RoomAssemblyState[]> {
    return instrumented(eventSink, 'listRoomAssemblies', () =>
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, caller);
        if (!authorizeCollection(account))
          throw createAppError('AUTHORIZATION');
        const rows = await tx
          .select()
          .from(rooms)
          .where(
            or(
              eq(rooms.visibility, 'public'),
              eq(rooms.hostActorId, caller.actorId),
              sql`exists (select 1 from room_participants rp where rp.room_id = ${rooms.id} and rp.actor_id = ${caller.actorId})`,
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
      database.transaction(async (tx) => {
        const account = await lockedAccount(tx, input.caller);
        if (!input.authorize(account)) throw createAppError('AUTHORIZATION');
        await lockCommand(tx, input.commandId);
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
