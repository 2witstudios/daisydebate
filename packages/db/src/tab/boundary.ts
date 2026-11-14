import { and, asc, eq } from 'drizzle-orm';
import { loadAuthorizationAccount } from '../authorization';
import { entryMembers } from '../schema/entries';
import {
  guardianLinks,
  restrictionLobbies,
  restrictions,
} from '../schema/guardian-links';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/**
 * A minor's boundary, as the evaluator reads it (`BoundaryFact`): the
 * lobbies their guardians allow, the tournaments they hold an accepted
 * entry in, and the account revision every guardian command moves.
 */
export type BoundaryAuthority = {
  readonly allowedLobbyIds: readonly string[];
  readonly entryLobbyIds: readonly string[];
  readonly revision: number;
};

/** The account as a Tab authority assembly hands it to the evaluator. */
export type TabAccount = NonNullable<
  Awaited<ReturnType<typeof loadAuthorizationAccount>>
> & {
  /**
   * Always loaded: an absent boundary reads as unbounded, so no assembly
   * may leave it out. Null is no boundary: no active link limits lobbies.
   */
  readonly boundary: BoundaryAuthority | null;
};

/**
 * The boundary from each active restriction that limits lobbies. With more
 * than one guardian limiting, a lobby is allowed only when every one of
 * them allows it; with none, there is no boundary.
 */
export const boundaryOf = (
  limiting: readonly (readonly string[])[],
  entryLobbyIds: readonly string[],
  revision: number,
): BoundaryAuthority | null => {
  const [first, ...rest] = limiting;
  if (first === undefined) return null;
  return {
    allowedLobbyIds: [...new Set(first)]
      .filter((lobbyId) => rest.every((other) => other.includes(lobbyId)))
      .sort(),
    entryLobbyIds: [...new Set(entryLobbyIds)].sort(),
    revision,
  };
};

/** A boundary read for someone who is not the transaction's subject. */
export class BoundaryOutsideSubject extends Error {
  constructor() {
    super("A boundary is read only for the transaction's subject");
  }
}

/**
 * Loads a person's boundary, in a transaction whose subject is that
 * person: the guardian tables show a person only their own rows, so a read
 * for anyone else would see none and answer unbounded. That is refused.
 */
export const loadBoundary = async (
  tx: TabTransaction,
  person: {
    readonly userId: string;
    readonly actorId: string | null;
    readonly revision: number;
  },
  scope: TenantScope,
): Promise<BoundaryAuthority | null> => {
  if (scope.subjectUserId !== person.userId) throw new BoundaryOutsideSubject();
  const rows = await tx
    .select({
      guardianLinkId: restrictions.guardianLinkId,
      lobbyId: restrictionLobbies.lobbyId,
    })
    .from(restrictions)
    .innerJoin(guardianLinks, eq(guardianLinks.id, restrictions.guardianLinkId))
    .leftJoin(
      restrictionLobbies,
      eq(restrictionLobbies.guardianLinkId, restrictions.guardianLinkId),
    )
    .where(
      and(
        eq(restrictions.minorUserId, person.userId),
        eq(restrictions.limitsLobbies, true),
        eq(guardianLinks.status, 'active'),
      ),
    )
    .orderBy(asc(restrictions.guardianLinkId));
  const limiting = new Map<string, string[]>();
  for (const row of rows) {
    const lobbies = limiting.get(row.guardianLinkId) ?? [];
    if (row.lobbyId !== null) lobbies.push(row.lobbyId);
    limiting.set(row.guardianLinkId, lobbies);
  }
  if (limiting.size === 0) return null;
  const entered =
    person.actorId === null
      ? []
      : await tx
          .select({ lobbyId: entryMembers.lobbyId })
          .from(entryMembers)
          .where(
            and(
              eq(entryMembers.actorId, person.actorId),
              eq(entryMembers.entryStatus, 'accepted'),
            ),
          );
  return boundaryOf(
    [...limiting.values()],
    entered.map((row) => row.lobbyId),
    person.revision,
  );
};

/** The person's account with their boundary, or null without an account. */
export const loadTabAccount = async (
  tx: TabTransaction,
  userId: string,
  scope: TenantScope,
): Promise<TabAccount | null> => {
  const account = await loadAuthorizationAccount(tx, userId);
  return account === null
    ? null
    : { ...account, boundary: await loadBoundary(tx, account, scope) };
};

/** A named counterpart's account, with its boundary loaded under that person. */
export const loadTabCounterpart = async (
  tx: TabTransaction,
  userId: string,
  scope: TenantScope,
): Promise<TabAccount | null> => {
  const subject = { ...scope, subjectUserId: userId };
  await scopeTransaction(tx, subject);
  const account = await loadTabAccount(tx, userId, subject);
  await scopeTransaction(tx, scope);
  return account;
};
