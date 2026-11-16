import { and, desc, eq, inArray } from 'drizzle-orm';
import { seasons } from '../schema/ratings';
import { seasonStandingRules, sanctions } from '../schema/sanctions';
import { organizations } from '../schema/organizations';
import { templates } from '../schema/templates';
import { users } from '../schema/users';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { timeSlots } from '../schema/events';
import { fenceOrganizationRead } from './organization-fence';
import { loadAuthorityContext } from './authority-context';
import { readDatabaseTime } from '../database-clock';
import { loadLeagueEvents } from './league-events';
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
  const events = await loadLeagueEvents(tx, { ...input, seasonId: season.id });
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
    if (lobby)
      calendar.push({
        lobby,
        startsAt: slot?.startsAt ?? lobby.createdAt,
        sanction: approval,
      });
  }
  await scopeTransaction(tx, scope);
  return {
    organization,
    season,
    rule,
    series,
    events,
    people,
    schools,
    calendar,
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
