import {
  createBoundedTransaction,
  type BoundedTransaction,
} from '../src/bounded-transaction';
import { withFixture, type Fixture } from './constraint-helpers';
import { SQL, type ReservedSQL } from 'bun';
import type { OwnedBackend } from '../src/transaction-watchdog';
export const backendOf = async (client: ReservedSQL) => {
  const [backend] = await client<OwnedBackend[]>`select pg_backend_pid() as pid,
    backend_start::text as started from pg_stat_activity where pid=pg_backend_pid()`;
  return backend!;
};

export const withPool = async (work: (client: SQL) => Promise<void>) => {
  const client = new SQL(process.env.TEST_DATABASE_URL!, { max: 4 });
  try {
    await work(client);
  } finally {
    await client.close({ timeout: 0 });
  }
};

/** A real isolated row plus the production transaction factory, cleaned even on refusal. */
export const withBoundedRound = async (
  work: (
    fixture: Fixture,
    run: BoundedTransaction,
    roundId: string,
  ) => Promise<void>,
) =>
  withFixture(process.env.TEST_DATABASE_URL!, (fixture) =>
    withPool(async (client) => {
      const roundId = await fixture.round();
      await work(
        fixture,
        createBoundedTransaction({
          client,
          maxConnections: 4,
          now: performance.now,
        }),
        roundId,
      );
    }),
  );
