import { and, asc, eq, inArray } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { entryMembers } from '../schema/entries';
import {
  guardianLinks,
  restrictions,
  restrictionLobbies,
} from '../schema/guardian-links';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadTabAccount } from './boundary';
import type { TabTransaction } from './tab-transaction';

/** Counterpart facts are read under the actual account's subject fence. */
export const loadEntryPeople = async (
  tx: TabTransaction,
  scope: TenantScope,
  actorIds: readonly string[],
) => {
  const people = actorIds.length
    ? await tx
        .select({ actorId: actors.id, userId: actors.userId })
        .from(actors)
        .where(inArray(actors.id, [...new Set(actorIds)]))
        .orderBy(asc(actors.id))
    : [];
  const loaded = [];
  for (const person of people) {
    const subject = { ...scope, subjectUserId: person.userId ?? undefined };
    await scopeTransaction(tx, subject);
    const account =
      person.userId === null
        ? null
        : await loadTabAccount(tx, person.userId, subject);
    const links =
      person.userId === null
        ? []
        : await tx
            .select()
            .from(guardianLinks)
            .where(eq(guardianLinks.minorUserId, person.userId));
    const limiting =
      person.userId === null
        ? []
        : await tx
            .select({
              guardianLinkId: restrictions.guardianLinkId,
              guardianUserId: restrictions.guardianUserId,
              minorUserId: restrictions.minorUserId,
              version: restrictions.version,
              lobbyId: restrictionLobbies.lobbyId,
            })
            .from(restrictions)
            .innerJoin(
              guardianLinks,
              eq(guardianLinks.id, restrictions.guardianLinkId),
            )
            .leftJoin(
              restrictionLobbies,
              eq(
                restrictionLobbies.guardianLinkId,
                restrictions.guardianLinkId,
              ),
            )
            .where(
              and(
                eq(restrictions.minorUserId, person.userId),
                eq(restrictions.limitsLobbies, true),
                eq(guardianLinks.status, 'active'),
              ),
            )
            .orderBy(asc(restrictions.guardianLinkId));
    const previousEntries = await tx
      .select({
        entryId: entryMembers.entryId,
        eventId: entryMembers.eventId,
        status: entryMembers.entryStatus,
      })
      .from(entryMembers)
      .where(eq(entryMembers.actorId, person.actorId));
    loaded.push({ ...person, account, links, limiting, previousEntries });
  }
  await scopeTransaction(tx, scope);
  return loaded;
};
export type EntryPersonRow = Awaited<
  ReturnType<typeof loadEntryPeople>
>[number];
