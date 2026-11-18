import type { SQL } from 'bun';
import { sql } from 'drizzle-orm';

/**
 * The kinds of background work a command can create, each waking the
 * worker loops that look for it (ADR 0153). A wake is a lossy hint: it
 * grants nothing and carries no row, so a missed one costs at most a
 * loop's idle back-off cap.
 */
export const WORK_KINDS = ['round', 'judging', 'analysis'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
const CHANNEL = 'daisy_work';

const isWorkKind = (payload: string): payload is WorkKind =>
  (WORK_KINDS as readonly string[]).includes(payload);

/**
 * Says `kind` work may now be waiting, from the transaction that created
 * it: PostgreSQL delivers a NOTIFY only on commit, never for a rollback.
 */
export async function notifyWork(
  tx: { readonly execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  kind: WorkKind,
): Promise<void> {
  await tx.execute(sql`select pg_notify(${CHANNEL}, ${kind})`);
}

export type WorkWakeHandlers = {
  readonly onNotify: (kind: WorkKind) => void;
  /**
   * Fires once the LISTEN is acknowledged and after every reconnect:
   * notifications sent while it was down are lost, so every loop looks once.
   */
  readonly onListen: () => void;
};

/** Subscribes to work wakes on a dedicated connection; unknown payloads are dropped. */
export async function subscribeWorkWakes(
  client: SQL,
  handlers: WorkWakeHandlers,
): Promise<{ readonly unlisten: () => Promise<void> }> {
  let closed = false;
  const subscription = await client.listen(
    'daisy_work',
    (payload: string) => {
      if (!closed && isWorkKind(payload)) handlers.onNotify(payload);
    },
    () => {
      if (!closed) handlers.onListen();
    },
  );
  return {
    async unlisten() {
      if (closed) return;
      closed = true;
      await subscription.unlisten();
    },
  };
}
