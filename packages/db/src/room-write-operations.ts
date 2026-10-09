import { persistRoomMutation } from './room-mutation-persistence';

import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
} from '@daisy/protocol';

import { createAppError } from '@daisy/errors';

import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { rooms, roomParticipants } from './schema/rooms';

import {
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  actorFact,
  roomState,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
} from './room-command-facts';
export const roomWriteOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
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
        await lockAuthorizationActors(tx, fencedActors, {
          maxActors: fencedActors.length,
        });
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
          throw createAppError(refusalCode(outcome.refusal), outcome.refusal);
        const next = outcome.mutation.state;
        const roundRef = await persistRoomMutation(
          tx,
          outcome.mutation,
          input.roundId,
          now,
        );
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

const refusalCode = (refusal: string) =>
  refusal === 'host-required'
    ? ('AUTHORIZATION' as const)
    : refusal === 'readiness-unavailable'
      ? ('INFRASTRUCTURE' as const)
      : ('CONFLICT' as const);
