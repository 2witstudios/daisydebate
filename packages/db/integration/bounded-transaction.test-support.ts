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

/** Lose the reply after PostgreSQL commits on the selected reserved connection. */
export function loseTransactionCommitReply(client: SQL, reservation: number) {
  const reserve = client.reserve.bind(client);
  let reserved = 0;
  client.reserve = async (options) => {
    const connection = await reserve(options);
    if (++reserved !== reservation) return connection;
    return new Proxy(connection, {
      apply(target, thisArg, args) {
        const query = Reflect.apply(target, thisArg, args);
        const template = args[0];
        if (Array.isArray(template) && template[0] === 'commit')
          return query.then(() => {
            throw new Error('injected lost COMMIT reply');
          });
        return query;
      },
    });
  };
  return () => {
    client.reserve = reserve;
  };
}

/** A real isolated row plus the production transaction factory, cleaned even on refusal. */
export const withBoundedRound = async (
  work: (
    fixture: Fixture,
    run: BoundedTransaction,
    roundId: string,
    client: SQL,
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
        client,
      );
    }),
  );
