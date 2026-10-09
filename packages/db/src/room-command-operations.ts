import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from './instrumented';
import { roomReadOperations } from './room-read-operations';
import { roomCreateOperations } from './room-create-operations';
import { roomWriteOperations } from './room-write-operations';
/** One canonical durable Room command/projection adapter. */
export const roomCommandOperations = (input: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...roomReadOperations(input),
  ...roomCreateOperations(input),
  ...roomWriteOperations(input),
});
