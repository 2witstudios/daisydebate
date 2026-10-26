import type { roomCommandTransaction } from './room-command-transaction';
import type { RoomCommandReceipt, FormatDefinition } from '@daisy/protocol';

import { createAppError } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { rooms } from './schema/rooms';
import { holdActiveRoomMembers } from './room-membership-persistence';

import { newRoomValues, type NewRoom } from './room-operations';

import {
  type Caller,
  type Account,
  lockedAccount,
  publishDefinition,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
} from './room-command-facts';
export const roomCreateOperations = ({
  transaction,
  eventSink,
}: {
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createRoomCommand(input: {
    readonly room: NewRoom;
    /** The engine's member set for the new Room: its host (ADR 0070). */
    readonly members: readonly string[];
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly definition: FormatDefinition | null;
    readonly caller: Caller;
    readonly authorize: (account: Account) => boolean;
  }): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'createRoomCommand', () =>
      transaction(async (tx) => {
        await lockCommand(tx, input.commandId);
        const account = await lockedAccount(tx, input.caller);
        if (
          input.caller.actorId !== input.room.hostActorId ||
          !input.authorize(account)
        )
          throw createAppError('AUTHORIZATION');
        const replay = await replayReceipt(
          tx,
          input.commandId,
          input.room.hostActorId,
          input.payloadDigest,
        );
        if (replay) return replay;
        if (input.definition)
          await publishDefinition(
            tx,
            input.room.formatId,
            input.room.hostActorId,
            input.definition,
          );
        const now = await transactionNow(tx);
        await tx.insert(rooms).values({
          ...newRoomValues(input.room, 'assembling'),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        await holdActiveRoomMembers(tx, input.room.id, input.members);
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
});
