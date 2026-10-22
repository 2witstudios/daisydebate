import type { ReservedSQL } from 'bun';

export type OwnedBackend = { readonly pid: number; readonly started: string };

/** A PID alone is reusable. Match its exact server timestamp and owning role/database. */
export async function recoverTransactionBackend(
  control: ReservedSQL,
  backend: OwnedBackend,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recovery = async () => {
    await control`begin`;
    await control`set local statement_timeout='800ms'`;
    await control`set local lock_timeout='800ms'`;
    await control`set local idle_in_transaction_session_timeout='800ms'`;
    await control`select pg_terminate_backend(pid, 500) from pg_stat_activity
      where pid=${backend.pid} and backend_start::text=${backend.started}
      and datname=current_database() and usename=current_user and backend_type='client backend'`;
    await control`select pg_stat_clear_snapshot()`;
    const [row] = await control<{ absent: boolean }[]>`select not exists (
      select 1 from pg_stat_activity where pid=${backend.pid}
      and backend_start::text=${backend.started}
    ) as absent`;
    await control`commit`;
    return row?.absent === true;
  };
  try {
    return await Promise.race([
      recovery(),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          void control.close({ timeout: 0 }).catch(() => undefined);
          resolve(false);
        }, 1000);
      }),
    ]);
  } catch {
    void control.close({ timeout: 0 }).catch(() => undefined);
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
