import type { RoundBotAdmission } from './round-bot-admission';
import { roomAuthorizationRead } from './room-authorization-read';
import { commandRetention } from './command-retention';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from './instrumented';
import { roomReadOperations } from './room-read-operations';
import { roomCreateOperations } from './room-create-operations';
import { roomWriteOperations } from './room-write-operations';
import type { roomCommandTransaction } from './room-command-transaction';
/** One canonical durable Room command/projection adapter. */
export const roomCommandOperations = (input: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly botAdmission?: RoundBotAdmission | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  ...commandRetention(input),
  ...roomReadOperations(input),
  ...roomAuthorizationRead(input),

  ...roomCreateOperations({
    transaction: input.commandTransaction,
    eventSink: input.eventSink,
  }),
  ...roomWriteOperations({
    botAdmission: input.botAdmission,
    transaction: input.commandTransaction,
    eventSink: input.eventSink,
  }),
});
