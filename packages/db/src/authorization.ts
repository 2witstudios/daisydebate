import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  authorizationAccountFact,
  type AuthorizationAccountRow,
} from './authorization-account';
/** The exact caller transaction, never a second pool or nested transaction. */
export type AuthorizationTransaction = Pick<BunSQLDatabase, 'execute'>;
/**
 * All account/contact/channel mutations acquire this fence first. SQL locks in
 * user-id order, independent of actor input order. Re-read after downstream lock
 * waits; a revision is an invalidation hint, not permission or a cache lease.
 */
export async function lockAuthorizationActors(
  tx: AuthorizationTransaction,
  actorIds: readonly string[],
) {
  if (
    actorIds.length === 0 ||
    actorIds.length > 50 ||
    new Set(actorIds).size !== actorIds.length ||
    actorIds.some((id) => !idSchema.safeParse(id).success)
  )
    throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select u.id as "userId", a.id as "actorId", a.kind as "actorKind",
      a.user_id as "actorUserId", u.username, u.email_verified as "emailVerified",
      u.deleted_at as "deletedAt", u.version as revision
    from users u join actors a on a.user_id = u.id
    where a.id in (${sql.join(
      actorIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by u.id for update of u
  `);
  return (rows as unknown as AuthorizationAccountRow[]).map(
    authorizationAccountFact,
  );
}
/** Read-only requests get fresh rows without keeping a cross-request cache. */
export async function loadAuthorizationAccount(
  tx: AuthorizationTransaction,
  userId: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select u.id as "userId", a.id as "actorId", a.kind as "actorKind",
      a.user_id as "actorUserId", u.username, u.email_verified as "emailVerified",
      u.deleted_at as "deletedAt", u.version as revision
    from users u left join actors a on a.user_id = u.id
    where u.id = ${userId}
  `);
  return authorizationAccountFact(
    (rows as unknown as AuthorizationAccountRow[])[0] ?? null,
  );
}
