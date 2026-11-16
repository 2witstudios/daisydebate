import { and, desc, eq, inArray } from 'drizzle-orm';
import { seasons } from '../schema/ratings';
import { seasonStandingRules, sanctions } from '../schema/sanctions';
import { organizations } from '../schema/organizations';
import { templates } from '../schema/templates';
import { users } from '../schema/users';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { timeSlots, events as eventRows } from '../schema/events';
import { settings } from '../schema/settings';
import { fenceOrganizationRead } from './organization-fence';
import { loadAuthorityContext } from './authority-context';
import { readDatabaseTime } from '../database-clock';
import { loadLeagueEvents } from './league-events';
import { loadLeagueMembershipEvents } from './league-membership-events';
import { loadLeagueRoomList } from './league-room-list';
import { scopeTransaction } from '../tenant-scope';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly viewerUserId: string;
  readonly organizationId: string;
  readonly seasonId?: string;
};
async function load(tx: TabTransaction, input: Input) {
  const scope = await fenceOrganizationRead(tx, input);
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.viewerUserId,
    'share',
  );
  if (authorization.organization?.organizationKind !== 'league') return null;
  const [organization] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId));
  const [season] = await tx
    .select()
    .from(seasons)
    .where(
      and(
        eq(seasons.organizationId, input.organizationId),
        ...(input.seasonId ? [eq(seasons.id, input.seasonId)] : []),
      ),
    )
    .orderBy(desc(seasons.startsAt))
    .limit(1)
    .for('share');
  if (!organization || !season) return null;
  const [rule] = await tx
    .select()
    .from(seasonStandingRules)
    .where(eq(seasonStandingRules.seasonId, season.id))
    .for('share');
  if (!rule) return null;
  const series = await tx
    .select()
    .from(templates)
    .where(eq(templates.organizationId, organization.id))
    .orderBy(templates.id);
  const [standingLobby] = await tx
    .select()
    .from(lobbies)
    .where(
      and(
        eq(lobbies.ownerOrganizationId, organization.id),
        eq(lobbies.kind, 'standing'),
      ),
    )
    .orderBy(lobbies.id)
    .limit(1);
  const templateSettings = await tx
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.organizationId, organization.id),
        eq(settings.scopeKind, 'template'),
      ),
    );
  const approvals = await tx
    .select()
    .from(sanctions)
    .where(
      and(
        eq(sanctions.organizationId, organization.id),
        eq(sanctions.seasonId, season.id),
      ),
    )
    .for('share');
  const automaticEvents =
    rule.counting === 'membership'
      ? await loadLeagueMembershipEvents(tx, {
          ...input,
          startsAt: season.startsAt,
          endsAt: season.endsAt,
        })
      : [];
  const events =
    rule.counting === 'membership'
      ? automaticEvents
      : await loadLeagueEvents(tx, { ...input, seasonId: season.id });
  const automaticCalendar = automaticEvents.map((row) => ({
    lobby: row.competition.configuration.lobby,
    event: row.competition.configuration.event,
    templateId: row.templateId,
    startsAt: row.startsAt,
    certifiedAt: row.certifiedAt,
  }));
  const peopleIds = [
    ...new Set(
      events.flatMap((row) =>
        row.competition.members.map((member) => member.actorId),
      ),
    ),
  ];
  const people = peopleIds.length
    ? await tx
        .select({ actorId: actors.id, name: users.username })
        .from(actors)
        .innerJoin(users, eq(users.id, actors.userId))
        .where(inArray(actors.id, peopleIds))
    : [];
  const schoolIds = [
    ...new Set(
      events.flatMap((row) =>
        row.competition.entries.flatMap((entry) =>
          entry.schoolOrganizationId ? [entry.schoolOrganizationId] : [],
        ),
      ),
    ),
  ];
  const schools = schoolIds.length
    ? await tx
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, schoolIds))
    : [];
  const calendar = [];
  for (const approval of approvals) {
    await scopeTransaction(tx, {
      subjectUserId: input.viewerUserId,
      lobbyId: approval.lobbyId,
    });
    const [lobby] = await tx
      .select()
      .from(lobbies)
      .where(eq(lobbies.id, approval.lobbyId));
    const [slot] = await tx
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, approval.lobbyId))
      .orderBy(timeSlots.startsAt)
      .limit(1);
    const [event] = await tx
      .select({
        id: eventRows.id,
        name: eventRows.name,
        templateId: eventRows.templateId,
      })
      .from(eventRows)
      .where(
        and(
          eq(eventRows.lobbyId, approval.lobbyId),
          eq(eventRows.id, approval.eventId),
        ),
      );
    if (lobby && event)
      calendar.push({
        lobby,
        event,
        startsAt: slot?.startsAt ?? lobby.createdAt,
        sanction: approval,
      });
  }
  await scopeTransaction(tx, scope);
  const roomList = await loadLeagueRoomList(tx, {
    ...input,
    lobbyId: standingLobby?.id ?? null,
  });
  await scopeTransaction(tx, scope);
  return {
    ...roomList,
    organization,
    standingLobby: standingLobby ?? null,
    templateSettings,
    season,
    rule,
    series,
    events,
    people,
    schools,
    calendar,
    automaticCalendar,
    authorization,
    now: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type LeagueSeasonFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createLeagueSeasonStore = (database: TabDatabase) => ({
  leagueSeason: <Answer>(
    input: Input,
    work: (facts: LeagueSeasonFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
