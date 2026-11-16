import { and, asc, eq } from 'drizzle-orm';
import { sanctions } from '../schema/sanctions';
import { scopeTransaction } from '../tenant-scope';
import {
  loadEventCompetition,
  type EventCompetitionFacts,
} from './event-competition';
import type { TabTransaction } from './tab-transaction';

/** A league receives certified competitive records, never ballots or unconfirmed corrections. */
export async function loadLeagueEvents(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly organizationId: string;
    readonly seasonId?: string;
  },
) {
  const scope = {
    subjectUserId: input.viewerUserId,
    organizationId: input.organizationId,
  };
  await scopeTransaction(tx, scope);
  const accepted = await tx
    .select()
    .from(sanctions)
    .where(
      and(
        eq(sanctions.organizationId, input.organizationId),
        eq(sanctions.status, 'approved'),
        ...(input.seasonId ? [eq(sanctions.seasonId, input.seasonId)] : []),
      ),
    )
    .orderBy(asc(sanctions.lobbyId), asc(sanctions.eventId))
    .for('share');
  const events: {
    competition: EventCompetitionFacts;
    certifiedAt: string | null;
    templateId: string;
  }[] = [];
  for (const sanction of accepted) {
    const competition = await loadEventCompetition(tx, {
      viewerUserId: input.viewerUserId,
      lobbyId: sanction.lobbyId,
      eventId: sanction.eventId,
      strength: 'share',
    });
    if (!competition) continue;
    const certifiedIds = new Set(
      competition.certified.map((row) => row.resultId),
    );
    const received = competition.results.filter((row) =>
      certifiedIds.has(row.id),
    );
    const certifiedAt =
      competition.certifications
        .map((row) => row.certifiedAt.toISOString())
        .sort()
        .at(-1) ?? null;
    events.push({
      competition: {
        ...competition,
        results: received,
        fixtures: competition.fixtures.filter((fixture) =>
          received.some((result) => result.fixtureId === fixture.id),
        ),
      },
      certifiedAt,
      templateId: sanction.templateId,
    });
    await scopeTransaction(tx, scope);
  }
  return events;
}
