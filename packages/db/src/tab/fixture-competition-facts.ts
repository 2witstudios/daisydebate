import { and, eq } from 'drizzle-orm';
import { fixtureEntries } from '../schema/fixtures';
import { entries, entryMembers } from '../schema/entries';
import { tournamentJudges } from '../schema/tournament-judges';
import { results } from '../schema/results';
import { ballotDefinitionVersions } from '../schema/ballot-definitions';
import { readRoomCompetitionProgress } from '../round-competition-source';
import { readDatabaseTime } from '../database-clock';
import { fixtureConnections } from './fixture-conflict';
import type { FixtureCommandContext } from './fixture-command-context';
import type { TabTransaction } from './tab-transaction';

/** The fixture's named published competitive input; corrections use only the retained result's source. */
export async function readFixtureCompetitionFacts(
  tx: TabTransaction,
  context: FixtureCommandContext,
  senderUserId: string,
) {
  const { configuration, fixture, authorization } = context;
  const placed = await tx
    .select({
      entryId: fixtureEntries.entryId,
      position: fixtureEntries.position,
      side: fixtureEntries.side,
      schoolOrganizationId: entries.schoolOrganizationId,
    })
    .from(fixtureEntries)
    .innerJoin(
      entries,
      and(
        eq(entries.id, fixtureEntries.entryId),
        eq(entries.lobbyId, fixture.lobbyId),
      ),
    )
    .where(eq(fixtureEntries.fixtureId, fixture.id))
    .orderBy(fixtureEntries.position);
  const members = await tx
    .select({ entryId: entryMembers.entryId, actorId: entryMembers.actorId })
    .from(entryMembers)
    .innerJoin(fixtureEntries, eq(fixtureEntries.entryId, entryMembers.entryId))
    .where(eq(fixtureEntries.fixtureId, fixture.id));
  const judges = await tx
    .select({ id: tournamentJudges.id, actorId: tournamentJudges.actorId })
    .from(tournamentJudges)
    .where(eq(tournamentJudges.lobbyId, fixture.lobbyId));
  const retained = await tx
    .select()
    .from(results)
    .where(
      and(
        eq(results.fixtureId, fixture.id),
        eq(results.lobbyId, fixture.lobbyId),
      ),
    )
    .orderBy(results.recordedAt);
  const room = context.room
    ? {
        rules: context.room.rulesSnapshot,
        ballotDefinitionId: context.room.ballotDefinitionId,
        ballotDefinitionVersion: context.room.ballotDefinitionVersion,
      }
    : null;
  const progress =
    fixture.roomId && context.roundSource === 'current-round'
      ? await readRoomCompetitionProgress(tx, fixture.roomId)
      : null;
  const pin = room ?? configuration.event;
  const [version] =
    pin.ballotDefinitionId !== null && pin.ballotDefinitionVersion !== null
      ? await tx
          .select()
          .from(ballotDefinitionVersions)
          .where(
            and(
              eq(
                ballotDefinitionVersions.ballotDefinitionId,
                pin.ballotDefinitionId,
              ),
              eq(ballotDefinitionVersions.version, pin.ballotDefinitionVersion),
            ),
          )
      : [];
  const connections = await fixtureConnections(tx, {
    fixtureId: fixture.id,
    roomId: fixture.roomId,
    userId: senderUserId,
  });
  return {
    connections,
    configuration,
    fixture,
    authorization,
    ownerActorId: context.ownerActorId,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
    entries: placed,
    members,
    judges,
    results: retained,
    progress,
    room,
    ballot: version ?? null,
  };
}
