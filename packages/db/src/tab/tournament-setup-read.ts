import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { readAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import { lobbies, tournaments } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { templates } from '../schema/templates';
import { formats } from '../schema/formats';
import { ballotDefinitions } from '../schema/ballot-definitions';
import { events, stages, tabRounds, timeSlots } from '../schema/events';
import { sanctions } from '../schema/sanctions';
import { resolutionPools, poolResolutions } from '../schema/resolution-pools';
import { scopeTransaction } from '../tenant-scope';
import { loadOrganizationContext } from './organization-context';
import { loadTemplateRows } from './setting-definition-rows';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = { readonly viewerUserId: string; readonly lobbyId: string };
const eventRows = (tx: TabTransaction, lobbyId: string) =>
  tx
    .select()
    .from(events)
    .where(eq(events.lobbyId, lobbyId))
    .orderBy(asc(events.id));
const sanctionRows = (tx: TabTransaction, lobbyId: string) =>
  tx
    .select()
    .from(sanctions)
    .where(eq(sanctions.lobbyId, lobbyId))
    .orderBy(asc(sanctions.id));
/** A host's addressed tournament metadata; resolution text is never selected. */
const load = async (tx: TabTransaction, input: Input) => {
  await scopeTransaction(tx, { subjectUserId: input.viewerUserId });
  const [viewer] = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.userId, input.viewerUserId));
  if (viewer) await readAuthorizationActors(tx, [viewer.id], { maxActors: 1 });
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(and(eq(lobbies.id, input.lobbyId), eq(lobbies.kind, 'tournament')));
  if (!found) return null;
  const scope = {
    subjectUserId: input.viewerUserId,
    lobbyId: found.id,
    organizationId: found.ownerOrganizationId ?? undefined,
  };
  await scopeTransaction(tx, scope);
  const initialEvents = await eventRows(tx, found.id);
  const initialSanctions = await sanctionRows(tx, found.id);
  const templateIds = [
    ...new Set(
      initialEvents.flatMap((row) => (row.templateId ? [row.templateId] : [])),
    ),
  ].sort();
  const followed = templateIds.length
    ? await loadTemplateRows(tx, templateIds)
    : [];
  const organizationIds = [
    ...new Set([
      ...(found.ownerOrganizationId ? [found.ownerOrganizationId] : []),
      ...followed.map((row) => row.organizationId),
      ...initialSanctions.map((row) => row.organizationId),
    ]),
  ].sort();
  for (const organizationId of organizationIds) {
    await scopeTransaction(tx, { ...scope, organizationId });
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('share');
  }
  for (const row of [...followed].sort((a, b) => a.id.localeCompare(b.id))) {
    await scopeTransaction(tx, {
      ...scope,
      organizationId: row.organizationId,
    });
    await tx
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, row.id))
      .for('share');
  }
  await scopeTransaction(tx, scope);
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, found.id))
    .for('share');
  const currentEvents = await eventRows(tx, found.id);
  const currentSanctions = await sanctionRows(tx, found.id);
  if (
    !lobby ||
    lobby.ownerOrganizationId !== found.ownerOrganizationId ||
    lobby.ownerUserId !== found.ownerUserId ||
    currentEvents.length !== initialEvents.length ||
    currentEvents.some(
      (row, index) =>
        row.id !== initialEvents[index]?.id ||
        row.templateId !== initialEvents[index]?.templateId,
    ) ||
    currentSanctions.length !== initialSanctions.length ||
    currentSanctions.some(
      (row, index) =>
        row.id !== initialSanctions[index]?.id ||
        row.organizationId !== initialSanctions[index]?.organizationId,
    )
  )
    return null;
  const authorization = await loadOrganizationContext(
    tx,
    scope,
    input.viewerUserId,
    'share',
  );
  const [owner] = lobby.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  const [tournament] = await tx
    .select()
    .from(tournaments)
    .where(eq(tournaments.lobbyId, lobby.id));
  if (!tournament) return null;
  const ballotIds = currentEvents.flatMap((row) =>
    row.ballotDefinitionId ? [row.ballotDefinitionId] : [],
  );
  const poolWhere = or(
    eq(resolutionPools.lobbyId, lobby.id),
    ...(scope.organizationId
      ? [eq(resolutionPools.organizationId, scope.organizationId)]
      : []),
  );
  const pools = await tx
    .select()
    .from(resolutionPools)
    .where(poolWhere)
    .orderBy(asc(resolutionPools.id));
  return {
    lobby,
    tournament,
    authorization,
    ownerActorId: owner?.id ?? null,
    events: currentEvents,
    templates: templateIds.length
      ? await loadTemplateRows(tx, templateIds)
      : [],
    organizations: organizationIds.length
      ? await tx
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, organizationIds))
      : [],
    formats: currentEvents.length
      ? await tx
          .select({ id: formats.id, name: formats.name })
          .from(formats)
          .where(
            inArray(formats.id, [
              ...new Set(currentEvents.map((row) => row.formatId)),
            ]),
          )
      : [],
    ballots: ballotIds.length
      ? await tx
          .select({ id: ballotDefinitions.id, name: ballotDefinitions.name })
          .from(ballotDefinitions)
          .where(inArray(ballotDefinitions.id, ballotIds))
      : [],
    stages: await tx
      .select()
      .from(stages)
      .where(eq(stages.lobbyId, lobby.id))
      .orderBy(asc(stages.sequence), asc(stages.id)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, lobby.id))
      .orderBy(asc(tabRounds.number), asc(tabRounds.id)),
    slots: await tx
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, lobby.id))
      .orderBy(asc(timeSlots.startsAt), asc(timeSlots.id)),
    sanctions: currentSanctions,
    pools,
    poolSizes: pools.length
      ? await tx
          .select({
            poolId: poolResolutions.poolId,
            count: sql<number>`count(*)::int`,
          })
          .from(poolResolutions)
          .where(
            and(
              inArray(
                poolResolutions.poolId,
                pools.map((row) => row.id),
              ),
              isNull(poolResolutions.retiredAt),
            ),
          )
          .groupBy(poolResolutions.poolId)
      : [],
  };
};
export type TournamentSetupFacts = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export const createTournamentSetupReadStore = (database: TabDatabase) => ({
  tournamentSetup: <Answer>(
    input: Input,
    work: (facts: TournamentSetupFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
