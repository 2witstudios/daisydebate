import type { EventCompetitionFacts } from '@daisy/db/tab';

/** Both append-only counts are sampled under the event/lobby metadata fence. */
export const eventResultsVersion = (
  facts: Pick<EventCompetitionFacts, 'results' | 'certifications'>,
) => 1 + facts.results.length + facts.certifications.length;
