import { sql, type SQL } from 'drizzle-orm';
import { run } from './raw-rows';
import type { AdminTx } from './tx';

const lockBrand: unique symbol = Symbol('admin transaction lock');

export type AdminTransactionLock = {
  readonly [lockBrand]: true;
  readonly key: SQL;
};

/**
 * Every advisory lock the admin app takes, by what it serializes. The key
 * is exactly the one taken before the registry, so a lock already held by
 * a running process still excludes it. A lock not named here cannot be taken.
 */
export const adminTransactionLocks = {
  /** Every audit append, so each row reads the true head of the chain. */
  auditChain: (): AdminTransactionLock => ({
    [lockBrand]: true,
    key: sql`hashtext('daisy-admin-audit-chain')`,
  }),
} as const;

/** Takes `lock` until the caller's transaction ends. */
export async function takeLock(tx: AdminTx, { key }: AdminTransactionLock) {
  await run(tx, sql`select pg_advisory_xact_lock(${key})`);
}
