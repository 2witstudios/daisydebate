import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roomCommands } from './schema/room-commands';
import { roundCommands } from './schema/round-commands';
/** Accepted DEC-81 window is applied by the injected-clock sweep; rows never retain forever. */
export const commandRetention = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  purgeExpiredRoomCommands: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoomCommands', () =>
      deleteExpiredBatch(
        database,
        {
          table: roomCommands,
          key: roomCommands.commandId,
          at: roomCommands.appliedAt,
        },
        batch,
      ),
    ),
  purgeExpiredRoundCommands: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoundCommands', () =>
      deleteExpiredBatch(
        database,
        {
          table: roundCommands,
          key: roundCommands.commandId,
          at: roundCommands.appliedAt,
        },
        batch,
      ),
    ),
});
