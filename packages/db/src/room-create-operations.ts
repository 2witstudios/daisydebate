import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoomCommandReceipt, FormatDefinition } from '@daisy/protocol';

import { createAppError } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { rooms } from './schema/rooms';

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
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createRoomCommand(input: {
    readonly room: NewRoom;
    readonly maxOpenRooms: number;
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
        // Serialize the explicitly configured open-Room cap across instances.
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
        if (!Number.isSafeInteger(input.maxOpenRooms) || input.maxOpenRooms < 1)
          throw createAppError('INVARIANT');
        if (Number(count?.count ?? 0) >= input.maxOpenRooms)
          throw createAppError('RATE_LIMIT');
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
