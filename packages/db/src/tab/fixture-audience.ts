import { and, eq } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { entries, entryMembers } from '../schema/entries';
import { fixtureEntries } from '../schema/fixtures';
import { guardianLinks } from '../schema/guardian-links';
import { releases } from '../schema/releases';
import { tournamentJudges } from '../schema/tournament-judges';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import type { Tx } from '../tx';

/** Only this fixture's responsible schools; parents are fenced before their authority is loaded. */
export const fixtureSchoolIds = async (tx: Tx, fixtureId: string) => {
  const rows = await tx
    .select({ id: entries.schoolOrganizationId })
    .from(fixtureEntries)
    .innerJoin(entries, eq(entries.id, fixtureEntries.entryId))
    .where(eq(fixtureEntries.fixtureId, fixtureId));
  return [
    ...new Set(rows.flatMap(({ id }) => (id === null ? [] : [id]))),
  ].sort();
};

/** Current relationships for the addressed fixture and recorded openings for its tab round. */
export const loadFixtureAudience = async (
  tx: Tx,
  input: {
    readonly fixtureId: string;
    readonly lobbyId: string;
    readonly tabRoundId: string;
    readonly userId: string;
    readonly schoolIds: readonly string[];
    readonly snapshot?: boolean;
    readonly scope: TenantScope;
  },
) => {
  const ownEntries = await tx
    .select({ id: entries.id, responsibleKind: entries.responsibleKind })
    .from(fixtureEntries)
    .innerJoin(entries, eq(entries.id, fixtureEntries.entryId))
    .innerJoin(entryMembers, eq(entryMembers.entryId, entries.id))
    .innerJoin(actors, eq(actors.id, entryMembers.actorId))
    .where(
      and(
        eq(fixtureEntries.fixtureId, input.fixtureId),
        eq(actors.userId, input.userId),
      ),
    );
  const wards = await tx
    .select({ id: entries.id })
    .from(fixtureEntries)
    .innerJoin(entries, eq(entries.id, fixtureEntries.entryId))
    .innerJoin(guardianLinks, eq(guardianLinks.id, entries.guardianLinkId))
    .where(
      and(
        eq(fixtureEntries.fixtureId, input.fixtureId),
        eq(guardianLinks.guardianUserId, input.userId),
        eq(guardianLinks.status, 'active'),
      ),
    );
  const entered = await tx
    .select({ id: entryMembers.entryId })
    .from(entryMembers)
    .innerJoin(actors, eq(actors.id, entryMembers.actorId))
    .where(
      and(
        eq(entryMembers.lobbyId, input.lobbyId),
        eq(entryMembers.entryStatus, 'accepted'),
        eq(actors.userId, input.userId),
      ),
    )
    .limit(1);
  const judging = await tx
    .select({ id: tournamentJudges.id })
    .from(tournamentJudges)
    .innerJoin(actors, eq(actors.id, tournamentJudges.actorId))
    .where(
      and(
        eq(tournamentJudges.lobbyId, input.lobbyId),
        eq(tournamentJudges.status, 'accepted'),
        eq(actors.userId, input.userId),
      ),
    )
    .limit(1);
  const openings = await tx
    .select({ thing: releases.thing, audience: releases.audience })
    .from(releases)
    .where(
      and(
        eq(releases.tabRoundId, input.tabRoundId),
        eq(releases.lobbyId, input.lobbyId),
      ),
    );
  const schools = [];
  for (const organizationId of input.schoolIds) {
    const scope = { subjectUserId: input.userId, organizationId };
    await scopeTransaction(tx, scope);
    schools.push(
      await loadAuthorityContext(
        tx,
        scope,
        input.userId,
        input.snapshot ? null : 'share',
      ),
    );
  }
  await scopeTransaction(tx, input.scope);
  return {
    ownEntry: ownEntries.length > 0,
    responsibleAdult:
      wards.length > 0 ||
      ownEntries.some(({ responsibleKind }) => responsibleKind === 'self'),
    participant: entered.length > 0 || judging.length > 0,
    schools,
    releases: openings,
  };
};
