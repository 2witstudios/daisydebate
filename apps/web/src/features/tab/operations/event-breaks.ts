import type { EventCompetitionFacts } from '@daisy/db/tab';
import { breaks, standings } from '@daisy/tab-engine';
import { eventCompetition } from './event-competition';

/** The current break is a fold; only a later draw freezes its own input. */
export function eventBreaks(
  facts: Parameters<typeof eventCompetition>[0] &
    Pick<EventCompetitionFacts, 'stages'>,
) {
  const stages = facts.stages.filter(
    (stage) => stage.eventId === facts.configuration.event.id,
  );
  const preliminary = stages.filter((stage) => stage.kind === 'preliminary');
  const rounds = facts.rounds.filter((round) =>
    preliminary.some((stage) => stage.id === round.stageId),
  );
  const input = eventCompetition(facts, {
    stageIds: preliminary.map((stage) => stage.id),
    cutoff: Math.max(0, ...rounds.map((round) => round.number)),
    division: null,
    seed: new TextEncoder().encode(facts.configuration.event.id),
  });
  const answer = breaks({
    ...input,
    stages: stages
      .filter((stage) => stage.kind === 'elimination')
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => ({ id: stage.id, division: stage.division })),
    choices: Object.fromEntries(
      facts.entries.flatMap((entry) => {
        const stage = stages.find(
          (stage) =>
            stage.kind === 'elimination' &&
            stage.division === entry.breakDivision,
        );
        return entry.breakDivision !== null && stage
          ? [[entry.id, stage.id]]
          : [];
      }),
    ),
  });
  const latest = facts.results.filter(
    (row) =>
      !facts.results.some((other) => other.supersedesResultId === row.id),
  );
  const complete =
    (preliminary.length === 0 || rounds.length > 0) &&
    rounds.every((round) => {
      const fixtures = facts.fixtures.filter(
        (fixture) =>
          fixture.tabRoundId === round.id && fixture.status === 'published',
      );
      return (
        fixtures.length > 0 &&
        fixtures.every((fixture) =>
          latest.some((result) => result.fixtureId === fixture.id),
        )
      );
    });
  return { answer, resultIds: standings(input).results, complete };
}
