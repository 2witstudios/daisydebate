import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  OUTBOX_ORIGIN,
  outboxRow,
  type OutboxPosition,
  type OutboxRow,
} from './outbox';

type Row = Record<string, unknown>;
/**
 * The fleet metadata relay's reads on the projection lane. Fixed functions give the projection role
 * commit-ordered positions and kinds for every row, but a payload only for revocation controls.
 */
export const relayOutboxOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'execute'>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async drainOutbox(
    cursor: OutboxPosition,
    limit = 256,
  ): Promise<readonly OutboxRow[]> {
    return instrumented(eventSink, 'drainRelayOutbox', async () => {
      const rows = await database.execute(
        sql`select seq, txid, topic, kind, version, payload, created_at as "createdAt" from public.daisy_relay_outbox(${cursor.txid}::xid8, ${cursor.seq.toString()}::bigint, ${limit})`,
      );
      return (rows as unknown as Row[]).map(outboxRow);
    });
  },
  async readOutboxHighWaterMark(): Promise<OutboxPosition> {
    return instrumented(eventSink, 'readRelayOutboxHighWaterMark', async () => {
      const [row] = (await database.execute(
        sql`select txid, seq from public.daisy_relay_outbox_high_water()`,
      )) as unknown as Row[];
      return row
        ? { txid: String(row.txid), seq: BigInt(row.seq as string) }
        : OUTBOX_ORIGIN;
    });
  },
});
