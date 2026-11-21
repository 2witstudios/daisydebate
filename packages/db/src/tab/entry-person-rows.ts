import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AgeBand } from '@daisy/protocol';
import { divisionAgeBand } from '../ladder-division-band';
import { accountAge } from '../schema/account-age';
import { actors } from '../schema/actors';
import { entryMembers } from '../schema/entries';
import { guardianLinks } from '../schema/guardian-links';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadAuthorizationAccount } from '../authorization';
import type { TabTransaction } from './tab-transaction';

/** Counterpart facts are read under the actual account's subject fence. */
export const loadEntryPeople = async (
  tx: TabTransaction,
  scope: TenantScope,
  actorIds: readonly string[],
  eligibility:
    | {
        readonly kind: 'standing';
        readonly lobbyId: string;
      }
    | { readonly kind: 'own'; readonly ageAsOf: string },
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
        : await loadAuthorizationAccount(tx, person.userId);
    const links =
      person.userId === null
        ? []
        : await tx
            .select()
            .from(guardianLinks)
            .where(
              and(
                eq(guardianLinks.minorUserId, person.userId),
                eq(guardianLinks.status, 'active'),
              ),
            );
    const previousEntries = await tx
      .select({
        entryId: entryMembers.entryId,
        eventId: entryMembers.eventId,
        status: entryMembers.entryStatus,
      })
      .from(entryMembers)
      .where(eq(entryMembers.actorId, person.actorId));
    if (eligibility.kind === 'standing')
      await scopeTransaction(tx, { ...subject, lobbyId: eligibility.lobbyId });
    // Use the lobby's season age for league tournaments and first-day age for self-run ones.
    const band =
      eligibility.kind === 'standing'
        ? divisionAgeBand(eligibility.lobbyId)
        : sql<AgeBand | null>`case when public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, clock_timestamp()) is null then null else public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, greatest(${eligibility.ageAsOf}::timestamptz, ${accountAge.recordedAt})) end`;
    const [atCompetition] =
      person.userId === null
        ? []
        : await tx
            .select({ band })
            .from(accountAge)
            .where(eq(accountAge.userId, person.userId));
    loaded.push({
      ...person,
      account,
      links,
      previousEntries,
      competitionAgeBand: atCompetition?.band ?? null,
    });
  }
  await scopeTransaction(tx, scope);
  return loaded;
};
