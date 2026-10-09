import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import {
  loadAuthorizationAccount,
  type AuthorizationTransaction,
} from './authorization';
import type {
  PrivacyAdopter,
  PrivacyFieldDeclaration,
} from './privacy/contracts';
import { accountAge } from './schema/account-age';
/** Same account-fenced transaction as send/contact/erasure; no external pool. */
export async function loadAccountAgeSource(
  tx: AuthorizationTransaction,
  userId: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = (await tx.execute(
    sql`select birth_month as "birthMonth",version as revision,recorded_at as "recordedAt" from ${accountAge} where user_id=${userId}`,
  )) as unknown as { birthMonth: string; revision: number; recordedAt: Date }[];
  const row = rows[0];
  return row
    ? {
        birthMonth: row.birthMonth,
        revision: row.revision,
        recordedAt: row.recordedAt.toISOString(),
      }
    : null;
}

export type AgeCollectionAuthority =
  | { readonly status: 'pending'; readonly decision: string }
  | { readonly status: 'approved'; readonly decision: string };
type AgeWriteInput = {
  readonly userId: string;
  readonly birthMonth: string;
  readonly now: string;
  readonly expectedAccountRevision: number;
  readonly expectedAgeRevision: number | null;
};
const validRevision = (revision: number) =>
  Number.isSafeInteger(revision) && revision > 0;
function validAgeWrite(input: AgeWriteInput, instant: Date) {
  const validTime =
    Number.isFinite(instant.getTime()) && instant.toISOString() === input.now;
  const validSource =
    /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(input.birthMonth) &&
    input.birthMonth <= input.now.slice(0, 7);
  const validExpected =
    validRevision(input.expectedAccountRevision) &&
    (input.expectedAgeRevision === null ||
      validRevision(input.expectedAgeRevision));
  return (
    idSchema.safeParse(input.userId).success &&
    validTime &&
    validSource &&
    validExpected
  );
}
async function requireCurrentAgeAccount(
  tx: AuthorizationTransaction,
  userId: string,
) {
  const rows = (await tx.execute(
    sql`select version,deleted_at as "deletedAt" from users where id=${userId} for update`,
  )) as unknown as { version: number; deletedAt: Date | null }[];
  const user = rows[0];
  if (!user || user.deletedAt !== null) throw createAppError('AUTHORIZATION');
  const account = await loadAuthorizationAccount(tx, userId);
  if (!account?.member) throw createAppError('AUTHORIZATION');
  return user;
}
/** No route enables this producer yet. Collection authority is trusted injected configuration. */
export async function writeAccountBirthMonth(
  database: Pick<
    import('drizzle-orm/bun-sql/postgres').BunSQLDatabase,
    'transaction'
  >,
  input: AgeWriteInput,
  authority: AgeCollectionAuthority,
) {
  if (authority.status !== 'approved' || !authority.decision.trim())
    throw createAppError('AUTHORIZATION');
  const instant = new Date(input.now);
  if (!validAgeWrite(input, instant)) throw createAppError('VALIDATION');
  return database.transaction(async (tx) => {
    const user = await requireCurrentAgeAccount(tx, input.userId);
    const source = await loadAccountAgeSource(tx, input.userId);
    if (
      user.version !== input.expectedAccountRevision ||
      (source?.revision ?? null) !== input.expectedAgeRevision
    )
      throw createAppError('CONFLICT');
    const nextRevision = (source?.revision ?? 0) + 1;
    await tx.execute(
      sql`insert into ${accountAge}(user_id,birth_month,version,recorded_at) values(${input.userId},${input.birthMonth},${nextRevision},${instant}) on conflict(user_id) do update set birth_month=excluded.birth_month,version=excluded.version,recorded_at=excluded.recorded_at`,
    );
    await tx.execute(
      sql`update users set version=version+1,updated_at=${instant} where id=${input.userId}`,
    );
    return {
      revision: nextRevision,
      accountRevision: input.expectedAccountRevision + 1,
    };
  });
}

const accountAgePrivacyFields: readonly PrivacyFieldDeclaration[] = [
  'user_id',
  'birth_month',
  'version',
  'recorded_at',
].map((column) => ({
  table: 'account_age',
  column,
  category:
    column === 'birth_month'
      ? 'personal'
      : column === 'user_id'
        ? 'identifier'
        : 'none',
  ...(column === 'birth_month' ? { visibility: 'private' as const } : {}),
  storage: 'postgres',
  owner: 'WAIT',
  purpose: 'Minimum durable source for current account age eligibility',
  lawfulBasis: { status: 'pending', decision: 'sznp9ay8e88ny2sg4xujosae' },
  retention: { status: 'pending', decision: 'jc0qcdvpkmqzrelpaesi3pah' },
  erasure: 'delete',
  exportable: true,
}));
export const accountAgePrivacyAdopter: PrivacyAdopter = {
  id: 'account-age',
  phase: 'after-scrub',
  fields: accountAgePrivacyFields,
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from ${accountAge} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const source = await loadAccountAgeSource(tx, subject.userId);
    return {
      account_age: source
        ? [
            {
              user_id: subject.userId,
              birth_month: source.birthMonth,
              version: source.revision,
              recorded_at: source.recordedAt,
            },
          ]
        : [],
    };
  },
};
