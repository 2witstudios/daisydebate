import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';
import { contactPairs } from '../schema/contacts';

/** One canonical member pair as the fence decided it. */
export type ContactFact = {
  readonly lowActorId: string;
  readonly highActorId: string;
  readonly blocked: boolean;
  readonly revision: number;
};
/** The acting member and the members a contact command addresses. */
export type ContactInput = {
  readonly actorId: string;
  readonly userId: string;
  readonly memberActorIds: readonly string[];
  readonly policyRevision?: number;
};
/** The capability's authorization over the locked accounts and pairs. */
export type ContactAuthorizationFence = (
  tx: AuthorizationTransaction,
  input: ContactInput,
  facts: {
    readonly contacts: readonly ContactFact[];
    readonly accounts: readonly ReturnType<typeof authorizationAccountFact>[];
  },
) => Promise<void>;
type ContactPairRow = typeof contactPairs.$inferSelect;
/** What a capability's frame is built on: the locked pairs and a re-fence. */
export type LockedContacts = {
  readonly rows: readonly ContactPairRow[];
  readonly contacts: readonly ContactFact[];
  readonly refresh: () => Promise<void>;
};

/**
 * Locks every proposed account, then every canonically ordered pair
 * (creating absent ones), and authorizes the command over them, all inside
 * the caller's transaction (ADR 0061, ADR 0072).
 */
async function lockContactPairs(
  tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  input: ContactInput,
  authorize: ContactAuthorizationFence,
): Promise<LockedContacts> {
  const members = [...input.memberActorIds].sort();
  const accounts = await lockAuthorizationActors(tx, members, {
    maxActors: 65535,
  });
  if (accounts.some((account) => account === null))
    throw createAppError('NOT_FOUND');
  const rows: ContactPairRow[] = [];
  for (const [index, low] of members.entries())
    for (const high of members.slice(index + 1)) {
      await tx
        .insert(contactPairs)
        .values({ lowActorId: low, highActorId: high })
        .onConflictDoNothing();
      const [pair] = await tx
        .select()
        .from(contactPairs)
        .where(
          and(
            eq(contactPairs.lowActorId, low),
            eq(contactPairs.highActorId, high),
          ),
        )
        .for('update');
      if (!pair) throw createAppError('NOT_FOUND');
      rows.push(pair);
    }
  const contacts = rows.map((pair) => ({
    lowActorId: pair.lowActorId,
    highActorId: pair.highActorId,
    blocked: pair.lowBlocksHigh || pair.highBlocksLow,
    revision: pair.revision,
  }));
  const refresh = () => authorize(tx, input, { contacts, accounts });
  await refresh();
  return { rows, contacts, refresh };
}

/**
 * One contact command's transaction: validates the members, locks and
 * fences the pairs, then runs `work` on the locked contacts.
 */
export function withContactPairs<T>(
  database: BunSQLDatabase,
  authorize: ContactAuthorizationFence,
  input: ContactInput,
  work: (
    tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
    locked: LockedContacts,
  ) => Promise<T>,
): Promise<T> {
  const members = [...input.memberActorIds].sort();
  if (
    !idSchema.safeParse(input.userId).success ||
    !members.includes(input.actorId) ||
    new Set(members).size !== members.length ||
    members.length < 2
  )
    throw createAppError('VALIDATION');
  // A technical bound prevents unbounded SQL construction; product bounds live at the edge.
  if ((members.length * (members.length - 1)) / 2 > 65535)
    throw createAppError('VALIDATION');
  return database.transaction(async (tx) =>
    work(tx, await lockContactPairs(tx, input, authorize)),
  );
}
