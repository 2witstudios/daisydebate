import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { authorizationAgeProjection } from './authorization-age';
import type { AuthorizationTransaction } from './authorization';
import type { authorizationAccountFact } from './authorization-account';

export async function authorizationAgeFacts(
  tx: AuthorizationTransaction,
  accounts: readonly NonNullable<ReturnType<typeof authorizationAccountFact>>[],
  now: string,
) {
  const instant = new Date(now);
  const actors = accounts.flatMap((a) =>
    a.actorId && a.member && !a.erased ? [a.actorId] : [],
  );
  if (actors.length > 4096 || !Number.isFinite(instant.getTime()))
    throw createAppError('INFRASTRUCTURE');
  const rows = actors.length
    ? await tx.execute(
        sql`select * from public.daisy_authorization_ages(array[${sql.join(
          actors.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[],${now}::timestamptz)`,
      )
    : [];
  const byActor = new Map(rows.map((row) => [row.actorId, row]));
  return accounts.map((account) => ({
    account,
    age: account.actorId
      ? authorizationAgeProjection(
          byActor.get(account.actorId) ?? {},
          {
            userId: account.userId,
            actorId: account.actorId,
            accountRevision: account.revision,
            now,
          },
          instant,
        )
      : { state: 'unknown' as const },
  }));
}
