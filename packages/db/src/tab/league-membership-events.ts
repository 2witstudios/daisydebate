import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { memberships } from '../schema/organizations';
import { leagueSchools } from '../schema/league-schools';
import { lobbies } from '../schema/lobbies';
import { events, timeSlots } from '../schema/events';
import { templates } from '../schema/templates';
import { certifications } from '../schema/certifications';
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
  // Membership counts as it stood when the event ran: every period that
  // began, kept with its end, so a school that left keeps its past points and
  // one that joined later gains none from before it joined.
  const members = await tx
    .select({
      userId: memberships.userId,
      joinedAt: memberships.joinedAt,
      endedAt: memberships.endedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        inArray(memberships.status, ['active', 'ended']),
        isNotNull(memberships.joinedAt),
      ),
    )
    .for('share');
  const schools = await tx
    .select({
      id: leagueSchools.schoolId,
      joinedAt: leagueSchools.joinedAt,
      endedAt: leagueSchools.endedAt,
    })
    .from(leagueSchools)
    .where(
      and(
        eq(leagueSchools.leagueId, input.organizationId),
        isNotNull(leagueSchools.joinedAt),
      ),
    )
    .for('share');
  const heldAt = (
    period: { readonly joinedAt: Date | null; readonly endedAt: Date | null },
    at: Date,
  ) =>
    period.joinedAt !== null &&
    period.joinedAt <= at &&
    (period.endedAt === null || at < period.endedAt);
  const memberUserIds = [...new Set(members.map((row) => row.userId))];
  const memberActors = memberUserIds.length
    ? await tx
        .select({ id: actors.id, userId: actors.userId })
        .from(actors)
        .where(inArray(actors.userId, memberUserIds))
    : [];
  const membersAt = (at: Date) => {
    const users = new Set(
      members.filter((row) => heldAt(row, at)).map((row) => row.userId),
    );
    return {
      users,
      actors: new Set(
        memberActors
          .filter((row) => row.userId !== null && users.has(row.userId))
          .map((row) => row.id),
      ),
      schools: new Set(
        schools.filter((row) => heldAt(row, at)).map((row) => row.id),
      ),
    };
  };
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
    const held = membersAt(at);
    if (
      lobby.ownerOrganizationId !== input.organizationId &&
      (lobby.ownerUserId === null || !held.users.has(lobby.ownerUserId))
    )
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
    // Only a certified event reaches the season, so a running tournament's
    // results are never read or held here.
    const certified = following.length
      ? await tx
          .select({ eventId: certifications.eventId })
          .from(certifications)
          .where(
            and(
              eq(certifications.lobbyId, lobby.id),
              inArray(
                certifications.eventId,
                following.map((event) => event.id),
              ),
            ),
          )
      : [];
    const certifiedEvents = new Set(certified.map((row) => row.eventId));
    for (const event of following) {
      if (!certifiedEvents.has(event.id)) continue;
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
              held.schools.has(entry.schoolOrganizationId),
          )
          .map((entry) => entry.id),
      );
      const eligibleMembers = competition.members.filter(
        (member) =>
          held.actors.has(member.actorId) ||
          eligibleEntryIds.has(member.entryId),
      );
      received.push({
        startsAt: at,
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
