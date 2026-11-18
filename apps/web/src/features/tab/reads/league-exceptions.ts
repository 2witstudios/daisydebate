import type { seasonStandings } from '@daisy/tab-engine';
import type { LeagueSeasonFacts } from '@daisy/db/tab';
export type LeagueSeasonException = {
  readonly entrant: string;
  readonly event: string;
  readonly message: string;
};
/** Engine identifiers stay inside the feature; people see named omissions, never silent partial totals. */
export function leagueSeasonExceptions(
  exceptions: ReturnType<typeof seasonStandings>['exceptions'],
  facts: Pick<LeagueSeasonFacts, 'people' | 'events'>,
): readonly LeagueSeasonException[] {
  return exceptions.map((row) => {
    const entrant =
      facts.people.find((person) => person.actorId === row.competitor)?.name ??
      'A competitor';
    const event =
      facts.events.find(
        (event) => event.competition.configuration.event.id === row.event,
      )?.competition.configuration.event.name ?? 'An event';
    const term =
      row.term === 'preliminary_win'
        ? 'Preliminary win points'
        : 'Elimination round points';
    const reason =
      row.reason === 'competitor_twice_in_event'
        ? 'the competitor appears in more than one entry'
        : 'this format has no preliminary winner';
    return {
      entrant,
      event,
      message: `${entrant} · ${event}: ${term} were not counted because ${reason}.`,
    };
  });
}
