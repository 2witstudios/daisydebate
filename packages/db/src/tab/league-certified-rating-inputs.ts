import { releaseThings, audiences } from '@daisy/protocol/lobby';
import { listedWord, listedWords } from '../lifecycle-sql';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { parsedColumn, postgresInstantMs } from '../raw-rows';
import { sanctions } from '../schema/sanctions';
import { results } from '../schema/results';
import { certificationResults, certifications } from '../schema/certifications';
import { releases } from '../schema/releases';
import { scopeTransaction } from '../tenant-scope';
import type { Tx } from '../tx';
import { loadLobbyAuthority } from './lobby-authority';

export type CertifiedSourceAuthority = NonNullable<
  Awaited<ReturnType<typeof loadLobbyAuthority>>
>;

/**
 * A narrow immutable input: received certified competition records already
 * contain their fixture and frozen cast. No unrelated event/roster/settings
 * fences are needed to read these append-only rows. The caller retains its
 * canonical account and actual organization/tournament fences.
 */
export async function loadLeagueCertifiedRatingInputs(
  tx: Tx,
  input: {
    readonly viewerUserId?: string;
    readonly organizationId: string;
    readonly seasonId: string;
    readonly publicAt?: string;
    readonly canReadSource?: (source: CertifiedSourceAuthority) => boolean;
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
  const sourceAccess = new Map<string, boolean>();
  for (const event of approved) {
    if (
      input.canReadSource &&
      input.viewerUserId &&
      !sourceAccess.has(event.lobbyId)
    ) {
      const source = await loadLobbyAuthority(tx, {
        viewerUserId: input.viewerUserId,
        lobbyId: event.lobbyId,
      });
      sourceAccess.set(
        event.lobbyId,
        source !== null && input.canReadSource(source),
      );
    }
    await scopeTransaction(tx, { ...scope, lobbyId: event.lobbyId });
    const received = await tx
      .select({
        id: results.id,
        eventId: results.eventId,
        fixtureId: results.fixtureId,
        supersedesResultId: results.supersedesResultId,
        competitionRecord: results.competitionRecord,
        recordedAt: results.recordedAt,
        playedAt: parsedColumn(
          postgresInstantMs.transform((ms) => new Date(ms)),
          sql`(select min(original_result.recorded_at) from results original_result where original_result.fixture_id = ${results.fixtureId})`,
        ),
      })
      .from(results)
      .innerJoin(
        certificationResults,
        eq(certificationResults.resultId, results.id),
      )
      .innerJoin(
        certifications,
        eq(certifications.id, certificationResults.certificationId),
      )
      .where(
        and(
          eq(results.eventId, event.eventId),
          input.publicAt === undefined || sourceAccess.get(event.lobbyId)
            ? undefined
            : and(
                lte(certifications.certifiedAt, new Date(input.publicAt)),
                sql`(select count(*) from ${releases} rel
            where rel.tab_round_id=${results.tabRoundId} and rel.audience=${listedWord(audiences, 'public')}
              and rel.thing in ${listedWords(releaseThings, ['posting', 'decision'])} and rel.opened_at<=${input.publicAt}::timestamptz)=2`,
              ),
        ),
      )
      .orderBy(asc(results.recordedAt), asc(results.id));
    records.push(...received);
  }
  await scopeTransaction(tx, scope);
  return [...new Map(records.map((row) => [row.id, row])).values()];
}

export type CertifiedRatingResults = Awaited<
  ReturnType<typeof loadLeagueCertifiedRatingInputs>
>;

export const certifiedRatingActors = (records: CertifiedRatingResults) =>
  records.flatMap(({ competitionRecord: record }) =>
    record.kind === 'decided'
      ? record.cast
          .filter((member) => member.entryId !== null)
          .map((member) => member.actorId)
      : record.fixture.entries.flatMap((entry) => entry.members),
  );
