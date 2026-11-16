import { and, asc, eq } from 'drizzle-orm';
import { entries, entryMembers } from '../schema/entries';
import { stages, tabRounds } from '../schema/events';
import { fixtures, fixtureEntries, fixtureJudges } from '../schema/fixtures';
import { results } from '../schema/results';
import { certificationResults, certifications } from '../schema/certifications';
import { actionHistory } from '../schema/grants';
import { draws } from '../schema/draws';
import { loadTournamentEventSettingFacts } from './tournament-event-settings';
import type { TabDatabase, TabTransaction } from './tab-transaction';

export type EventCompetitionInput = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId: string;
};

/** The event metadata fence protects a coherent append-only competition read. */
export async function loadEventCompetition(
  tx: TabTransaction,
  input: EventCompetitionInput,
) {
  const context = await loadTournamentEventSettingFacts(tx, input);
  if (!context) return null;
  const eventId = context.configuration.event.id;
  return {
    ...context,
    entries: await tx
      .select()
      .from(entries)
      .where(eq(entries.eventId, eventId)),
    members: await tx
      .select({ entryId: entryMembers.entryId, actorId: entryMembers.actorId })
      .from(entryMembers)
      .innerJoin(entries, eq(entries.id, entryMembers.entryId))
      .where(eq(entries.eventId, eventId)),
    stages: await tx.select().from(stages).where(eq(stages.eventId, eventId)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.eventId, eventId))
      .orderBy(asc(tabRounds.number)),
    fixtures: await tx
      .select()
      .from(fixtures)
      .where(eq(fixtures.eventId, eventId)),
    fixtureEntries: await tx
      .select({
        fixtureId: fixtureEntries.fixtureId,
        entryId: fixtureEntries.entryId,
        position: fixtureEntries.position,
      })
      .from(fixtureEntries)
      .innerJoin(fixtures, eq(fixtures.id, fixtureEntries.fixtureId))
      .where(eq(fixtures.eventId, eventId)),
    fixtureJudges: await tx
      .select({
        fixtureId: fixtureJudges.fixtureId,
        tournamentJudgeId: fixtureJudges.tournamentJudgeId,
        chair: fixtureJudges.chair,
      })
      .from(fixtureJudges)
      .innerJoin(fixtures, eq(fixtures.id, fixtureJudges.fixtureId))
      .where(eq(fixtures.eventId, eventId)),
    results: await tx
      .select()
      .from(results)
      .where(eq(results.eventId, eventId)),
    certifications: await tx
      .select()
      .from(certifications)
      .where(eq(certifications.eventId, eventId)),
    certified: await tx
      .select()
      .from(certificationResults)
      .where(eq(certificationResults.eventId, eventId)),
    draws: await tx.select().from(draws).where(eq(draws.eventId, eventId)),
    announcements: await tx
      .select({
        commandId: actionHistory.commandId,
        appliedAt: actionHistory.appliedAt,
        result: actionHistory.result,
      })
      .from(actionHistory)
      .where(
        and(
          eq(actionHistory.lobbyId, input.lobbyId),
          eq(actionHistory.aggregateId, eventId),
          eq(actionHistory.type, 'announce-break'),
        ),
      ),
  };
}
export type EventCompetitionFacts = NonNullable<
  Awaited<ReturnType<typeof loadEventCompetition>>
>;
export const createEventCompetitionStore = (database: TabDatabase) => ({
  eventCompetition: <Answer>(
    input: EventCompetitionInput,
    work: (facts: EventCompetitionFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) =>
      work(await loadEventCompetition(tx, input)),
    ),
});
