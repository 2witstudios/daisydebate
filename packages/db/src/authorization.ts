import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  authorizationAccountFact,
  type AuthorizationAccountRow,
} from './authorization-account';
/** The exact caller transaction, never a second pool or nested transaction. */
export type AuthorizationTransaction = Pick<
  BunSQLDatabase,
  'execute' | 'insert'
>;
/**
 * All account/contact/channel mutations acquire this fence first. SQL locks in
 * user-id order, independent of actor input order. Re-read after downstream lock
 * waits; a revision is an invalidation hint, not permission or a cache lease.
 */
async function authorizationActors(
  tx: AuthorizationTransaction,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
  shared: boolean,
) {
  if (
    actorIds.length === 0 ||
    !Number.isSafeInteger(limits.maxActors) ||
    limits.maxActors < 1 ||
    limits.maxActors > 65535 ||
    actorIds.length > limits.maxActors ||
    new Set(actorIds).size !== actorIds.length ||
    actorIds.some((id) => !idSchema.safeParse(id).success)
  )
    throw createAppError('VALIDATION');
  const selector = sql`array[${sql.join(
    actorIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  const rows = await tx.execute(
    shared
      ? sql`select * from public.daisy_authorization_read_accounts(${selector})`
      : sql`select * from public.daisy_authorization_accounts(${selector}, null::text, true)`,
  );
  const current = rows as unknown as AuthorizationAccountRow[];
  const byActor = new Map(current.map((row) => [row.actorId, row]));
  return actorIds.map((actorId) =>
    authorizationAccountFact(byActor.get(actorId) ?? null),
  );
}
/** Read-only requests get fresh rows without keeping a cross-request cache. */
export async function loadAuthorizationAccount(
  tx: AuthorizationTransaction,
  userId: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select * from public.daisy_authorization_accounts(null::text[], ${userId}::text, false)
  `);
  const account = authorizationAccountFact(
    (rows as unknown as AuthorizationAccountRow[])[0] ?? null,
  );
  return account?.userId === userId ? account : null;
}

export { loadAuthorizationSession } from './authorization-session';

/** Exclusive subject fence for account and authority writers. */
export const lockAuthorizationActors = (
  tx: AuthorizationTransaction,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
) => authorizationActors(tx, actorIds, limits, false);
/** Compatible account dependency fence; callers discover the complete ordered set first. */
export const readAuthorizationActors = (
  tx: AuthorizationTransaction,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
) => authorizationActors(tx, actorIds, limits, true);
