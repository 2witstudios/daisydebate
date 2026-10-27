import { createClient } from '@clickhouse/client-web';
import type { HeartbeatRow } from './health';
import type { Sink } from './ship';

/** The writer role ADR 0081 grants INSERT on `daisy_logs` and nothing else. */
const SHIPPER_USER = 'daisy_shipper';
const INSERT_TIMEOUT_MS = 10_000;

/**
 * Inserts event rows and drop tallies as JSONEachRow, each under the
 * batch's deduplication token: ClickHouse stores a retried insert once
 * (`non_replicated_deduplication_window`), while identical events in
 * different batches are both kept.
 */
export function createClickHouseSink({
  url,
  password,
}: {
  readonly url: string;
  readonly password: string;
}): Sink & {
  readonly insertHeartbeat: (row: HeartbeatRow) => Promise<void>;
  readonly close: () => Promise<void>;
} {
  const client = createClient({
    url,
    username: SHIPPER_USER,
    password,
    database: 'daisy_logs',
    request_timeout: INSERT_TIMEOUT_MS,
  });
  return {
    insertRows: async (rows, token) => {
      await client.insert({
        table: 'events',
        values: [...rows],
        format: 'JSONEachRow',
        clickhouse_settings: { insert_deduplication_token: token },
      });
    },
    insertDrops: async (drops, token) => {
      await client.insert({
        table: 'shipper_drops',
        values: [...drops],
        format: 'JSONEachRow',
        clickhouse_settings: { insert_deduplication_token: token },
      });
    },
    insertHeartbeat: async (row) => {
      await client.insert({
        table: 'shipper_heartbeats',
        values: [row],
        format: 'JSONEachRow',
      });
    },
    close: () => client.close(),
  };
}
