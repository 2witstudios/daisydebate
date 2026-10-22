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
