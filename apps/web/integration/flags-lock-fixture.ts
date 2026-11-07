import type { SQL, TransactionSQL } from 'bun';

/** Own the holder and both pools even when acquisition or the proof rejects. */
export async function withFlagsLock(
  client: SQL,
  database: { close(): Promise<void> },
  proof: (pid: number, release: () => void) => Promise<void>,
  acquire: (tx: TransactionSQL) => PromiseLike<unknown> = (tx) =>
    tx`select pg_advisory_xact_lock(59118,1)`,
) {
  const released = Promise.withResolvers<void>();
  const holding = Promise.withResolvers<number>();
  const holder = client.begin(async (tx) => {
    await tx`set local statement_timeout = '1500ms'`;
    await acquire(tx);
    const [row] = await tx`select pg_backend_pid() as pid`;
    holding.resolve(row!.pid);
    await released.promise;
  });
  void holder.catch(holding.reject);
  try {
    await proof(await holding.promise, released.resolve);
  } finally {
    released.resolve();
    try {
      await holder;
    } finally {
      try {
        await database.close();
      } finally {
        await client.close();
      }
    }
  }
}
