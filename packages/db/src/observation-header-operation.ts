import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { ObservationResource } from '@daisy/protocol';
import type { ObservationExecutionGuard } from './observation-contracts';
import { requireCurrentObservation } from './observation-guard';
import { readObservationHeaders } from './observation-headers';
/** Rechecks ownership after driver connection acquisition; the sole slot includes rollback settlement. */
export async function guardedObservationHeaders(
  database: Pick<BunSQLDatabase, 'transaction'>,
  resources: readonly ObservationResource[],
  guard: ObservationExecutionGuard = {},
) {
  requireCurrentObservation(guard);
  return database.transaction(
    async (tx) => {
      requireCurrentObservation(guard);
      return readObservationHeaders(tx, resources);
    },
    { isolationLevel: 'read committed' },
  );
}
