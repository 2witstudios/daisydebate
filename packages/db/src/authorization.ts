import { sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { query } from './raw-rows';
import { inTransaction, type Tx, type TxOpener } from './tx';
import { z } from 'zod';
import {
  betaAccessStates,
  type BetaAccessState,
} from '@daisy/protocol/beta-access';
function requireActorSelector(
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
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
}
async function accountFacts(
  tx: Tx,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
  producer: (ids: SQL) => SQL,
) {
  requireActorSelector(actorIds, limits);
  const rows = await query(
    tx,
    authorizationAccountRow,
    producer(
      sql`array[${sql.join(
        actorIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`,
    ),
  );
  return actorIds.map((actorId) =>
    authorizationAccountFact(
      rows.find((row) => row.actorId === actorId) ?? null,
    ),
  );
}
/**
 * All account/contact/channel mutations acquire this fence first. SQL locks in
 * user-id order, independent of actor input order. Re-read after downstream lock
 * waits; a revision is an invalidation hint, not permission or a cache lease.
 */
export const lockAuthorizationActors = (
  tx: Tx,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
) =>
  accountFacts(
    tx,
    actorIds,
    limits,
    (ids) =>
      sql`select * from public.daisy_authorization_accounts_v2(${ids}, null::text, true)`,
  );
/**
 * Readers take the same facts under a shared fence (MSG-2.1-arch1): readers
 * never wait on each other, and any account writer still waits for them and
 * they for it. Same user-id order. A transaction that took the exclusive
 * fence may read under the shared one (a weaker lock it already holds); one
 * that took the shared fence must never take the exclusive one afterwards:
 * that is a lock upgrade, and two such transactions deadlock.
 */
export const readAuthorizationActors = (
  tx: Tx,
  actorIds: readonly string[],
  limits: { readonly maxActors: number },
) =>
  accountFacts(
    tx,
    actorIds,
    limits,
    (ids) =>
      sql`select * from public.daisy_authorization_read_accounts_v2(${ids})`,
  );
/** The caller's decision over one actor's freshly locked account. */
export type OwnCollectionFence<S> = (input: {
  readonly tx: Tx;
  readonly scope: S;
  readonly account: Awaited<ReturnType<typeof lockAuthorizationActors>>[number];
}) => Promise<void>;

/** Refuses an own scope that is not two well-formed ids, before any query. */
export const requireOwnScope = (scope: {
  readonly userId: string;
  readonly actorId: string;
}) => {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success
  )
    throw createAppError('VALIDATION');
};

/**
 * One actor's read of their own collection: lock their account, let the
 * caller's decision run on it, then read in the same transaction.
 */
export function readOwnCollection<S extends { readonly actorId: string }, T>(
  database: TxOpener,
  scope: S,
  authorize: OwnCollectionFence<S>,
  read: (tx: Tx) => Promise<T>,
): Promise<T> {
  return inTransaction(database, async (tx) => {
    const [account] = await lockAuthorizationActors(tx, [scope.actorId], {
      maxActors: 1,
    });
    await authorize({ tx, scope, account: account ?? null });
    return read(tx);
  });
}

/** Read-only requests get fresh rows without keeping a cross-request cache. */
export async function loadAuthorizationAccount(tx: Tx, userId: string) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = await query(
    tx,
    authorizationAccountRow,
    sql`
    select * from public.daisy_authorization_accounts_v2(null::text[], ${userId}::text, false)
  `,
  );
  const account = authorizationAccountFact(rows[0] ?? null);
  return account?.userId === userId ? account : null;
}

export {
  loadAuthorizationSession,
  loadAuthorizationSessions,
} from './authorization-session';

/** Minimal facts returned only by the canonical database account producer. */
export const authorizationAccountRow = z.object({
  userId: z.string(),
  actorId: z.string().nullable(),
  member: z.boolean(),
  erased: z.boolean(),
  revision: z.number(),
  // ADR 0075: an account without a beta record has null state and revision.
  betaState: z.string().nullable(),
  betaRevision: z.number().nullable(),
  ageBand: z.string().nullable(),
  // ADR 0103: a suspension or ban is in force.
  restricted: z.boolean(),
});
export type AuthorizationAccountRow = Readonly<
  z.output<typeof authorizationAccountRow>
>;
const ageBands = ['under-13', '13-15', '16-17', 'adult'] as const;
function validBeta(row: AuthorizationAccountRow) {
  if (row.betaState === null)
    return row.betaRevision === null ? null : undefined;
  if (
    !betaAccessStates.includes(row.betaState as BetaAccessState) ||
    !Number.isSafeInteger(row.betaRevision) ||
    (row.betaRevision as number) < 1
  )
    return undefined;
  return {
    state: row.betaState as BetaAccessState,
    revision: row.betaRevision as number,
  };
}
function validIdentity(row: AuthorizationAccountRow): boolean {
  return (
    idSchema.safeParse(row.userId).success &&
    (row.actorId === null || idSchema.safeParse(row.actorId).success)
  );
}
/** Validate persistence output before it enters either HTTP or realtime authority. */
function validMembership(row: AuthorizationAccountRow): boolean {
  return (
    typeof row.member === 'boolean' &&
    typeof row.erased === 'boolean' &&
    typeof row.restricted === 'boolean' &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 1 &&
    !(row.member && (row.actorId === null || row.erased))
  );
}
/** A known band, null for none, undefined for anything malformed. */
const validAgeBand = (row: AuthorizationAccountRow) =>
  row.ageBand === null ? null : ageBands.find((band) => band === row.ageBand);
export function authorizationAccountFact(row: AuthorizationAccountRow | null) {
  if (!row || !validIdentity(row) || !validMembership(row)) return null;
  const beta = validBeta(row);
  const ageBand = validAgeBand(row);
  if (beta === undefined || ageBand === undefined) return null;
  return {
    userId: row.userId,
    actorId: row.actorId,
    member: row.member,
    erased: row.erased,
    revision: row.revision,
    beta,
    ageBand,
    restricted: row.restricted,
  };
}
