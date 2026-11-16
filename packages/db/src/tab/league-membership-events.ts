import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { memberships } from '../schema/organizations';
import { leagueSchools } from '../schema/league-schools';
import { lobbies } from '../schema/lobbies';
import { events, timeSlots } from '../schema/events';
import { templates } from '../schema/templates';
import { actors } from '../schema/actors';
import { scopeTransaction } from '../tenant-scope';
import { loadEventCompetition } from './event-competition';
import type { TabTransaction } from './tab-transaction';

/** Automatic season admission is host membership plus a followed league template, never participation alone. */
export async function loadLeagueMembershipEvents(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly organizationId: string;
    readonly startsAt: Date;
    readonly endsAt: Date | null;
  },
) {
  const scope = {
    subjectUserId: input.viewerUserId,
    organizationId: input.organizationId,
  };
  await scopeTransaction(tx, scope);
  const members = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.status, 'active'),
      ),
    )
    .for('share');
  const schools = await tx
    .select({ id: leagueSchools.schoolId })
    .from(leagueSchools)
    .where(
      and(
        eq(leagueSchools.leagueId, input.organizationId),
        eq(leagueSchools.status, 'active'),
      ),
    )
    .for('share');
  const memberUserIds = members.map((row) => row.userId),
    schoolIds = new Set(schools.map((row) => row.id));
  const memberActors = memberUserIds.length
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(inArray(actors.userId, memberUserIds))
    : [];
  const actorIds = new Set(memberActors.map((row) => row.id));
  const series = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.organizationId, input.organizationId));
  const seriesIds = series.map((row) => row.id);
  if (seriesIds.length === 0) return [];
  const hosted = await tx
    .select()
    .from(lobbies)
    .where(
      and(
        eq(lobbies.kind, 'tournament'),
        or(
          eq(lobbies.ownerOrganizationId, input.organizationId),
          ...(memberUserIds.length
            ? [inArray(lobbies.ownerUserId, memberUserIds)]
            : []),
        ),
      ),
    )
    .orderBy(asc(lobbies.id));
  const received = [];
  for (const lobby of hosted) {
    await scopeTransaction(tx, {
      subjectUserId: input.viewerUserId,
      lobbyId: lobby.id,
    });
    const [slot] = await tx
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, lobby.id))
      .orderBy(asc(timeSlots.startsAt))
      .limit(1);
    const at = slot?.startsAt ?? lobby.createdAt;
    if (at < input.startsAt || (input.endsAt !== null && at >= input.endsAt))
      continue;
    const following = await tx
      .select({ id: events.id, templateId: events.templateId })
      .from(events)
      .where(
        and(
          eq(events.lobbyId, lobby.id),
          inArray(events.templateId, seriesIds),
        ),
      )
      .orderBy(asc(events.id));
    for (const event of following) {
      const competition = await loadEventCompetition(tx, {
        viewerUserId: input.viewerUserId,
        lobbyId: lobby.id,
        eventId: event.id,
        strength: 'share',
      });
      if (!competition) continue;
      const certifiedIds = new Set(
        competition.certified.map((row) => row.resultId),
      );
      const results = competition.results.filter((row) =>
        certifiedIds.has(row.id),
      );
      const eligibleEntryIds = new Set(
        competition.entries
          .filter(
            (entry) =>
              entry.schoolOrganizationId !== null &&
              schoolIds.has(entry.schoolOrganizationId),
          )
          .map((entry) => entry.id),
      );
      const eligibleMembers = competition.members.filter(
        (member) =>
          actorIds.has(member.actorId) || eligibleEntryIds.has(member.entryId),
      );
      received.push({
        competition: {
          ...competition,
          results,
          members: eligibleMembers,
          fixtures: competition.fixtures.filter((fixture) =>
            results.some((result) => result.fixtureId === fixture.id),
          ),
        },
        templateId: event.templateId!,
        certifiedAt:
          competition.certifications
            .map((row) => row.certifiedAt.toISOString())
            .sort()
            .at(-1) ?? null,
      });
    }
  }
  await scopeTransaction(tx, scope);
  return received;
}
