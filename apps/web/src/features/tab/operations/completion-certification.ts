import type { EventCompletionFacts } from '@daisy/db/tab';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import { completionScreenings } from './completion-screenings';

/** Exact current-source inputs of both certification readiness and the command. */
export const completionCertification = (facts: EventCompletionFacts) => ({
  publishedFixtureIds: facts.competition.fixtures
    .filter((fixture) => fixture.status === 'published')
    .map((fixture) => fixture.id),
  results: facts.competition.results.map((row) => ({
    ...row,
    recordedAt: row.recordedAt.toISOString(),
    competitionRecord: resultCompetitionRecordSchema.parse(
      row.competitionRecord,
    ),
  })),
  certifiedResultIds: facts.competition.certified.map((row) => row.resultId),
  screenings: completionScreenings(facts),
});
