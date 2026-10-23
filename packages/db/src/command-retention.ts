import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roomCommands } from './schema/room-commands';
import { roundCommands } from './schema/round-commands';
import { roundCheckInAttempts } from './schema/round-attendance';
/** Accepted DEC-81 window is applied by the injected-clock sweep; durable attendance facts and speaking intervals retain their referenced receipts until owning Round erasure. */
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
  purgeExpiredRoundCheckInAttempts: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoundCheckInAttempts', () =>
      deleteExpiredBatch(
        database,
        {
          table: roundCheckInAttempts,
          key: roundCheckInAttempts.attemptId,
          at: roundCheckInAttempts.resolvedAt,
          eligible: sql`${roundCheckInAttempts.state} <> 'pending'`,
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
          eligible: sql`not exists(select 1 from round_check_ins a where a.command_id=${roundCommands.commandId})
            and not exists(select 1 from round_attendance_adjudications a where a.command_id=${roundCommands.commandId})
            and not exists(select 1 from round_check_in_attempts a where a.command_id=${roundCommands.commandId} and a.state='pending')
            and not exists(select 1 from round_speaking_intervals a where a.started_command_id=${roundCommands.commandId} or a.ended_command_id=${roundCommands.commandId})`,
        },
        batch,
      ),
    ),
});
