import { and, asc, eq, sql } from 'drizzle-orm';
import { sanctions } from '../schema/sanctions';
import { results } from '../schema/results';
import { certificationResults } from '../schema/certifications';
import { scopeTransaction } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/**
 * A narrow immutable input: received certified competition records already
 * contain their fixture and frozen cast. No unrelated event/roster/settings
 * fences are needed to read these append-only rows. The caller retains its
 * canonical account and actual organization/tournament fences.
 */
export async function loadLeagueCertifiedRatingInputs(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly organizationId: string;
    readonly seasonId: string;
  },
) {
  const scope = {
    subjectUserId: input.viewerUserId,
    organizationId: input.organizationId,
  };
  await scopeTransaction(tx, scope);
  const approved = await tx
    .select({ lobbyId: sanctions.lobbyId, eventId: sanctions.eventId })
    .from(sanctions)
    .where(
      and(
        eq(sanctions.organizationId, input.organizationId),
        eq(sanctions.seasonId, input.seasonId),
        eq(sanctions.status, 'approved'),
      ),
    )
    .orderBy(asc(sanctions.lobbyId), asc(sanctions.eventId));
  const records = [];
  for (const event of approved) {
    await scopeTransaction(tx, { ...scope, lobbyId: event.lobbyId });
    const received = await tx
      .select({
        id: results.id,
        eventId: results.eventId,
        fixtureId: results.fixtureId,
        supersedesResultId: results.supersedesResultId,
        competitionRecord: results.competitionRecord,
        recordedAt: results.recordedAt,
        playedAt:
          sql`(select min(original_result.recorded_at) from results original_result where original_result.fixture_id = ${results.fixtureId})`.mapWith(
            results.recordedAt,
          ),
      })
      .from(results)
      .innerJoin(
        certificationResults,
        eq(certificationResults.resultId, results.id),
      )
      .where(eq(results.eventId, event.eventId))
      .orderBy(asc(results.recordedAt), asc(results.id));
    records.push(...received);
  }
  await scopeTransaction(tx, scope);
  return [...new Map(records.map((row) => [row.id, row])).values()];
}
