import type { EventCompetitionFacts } from '@daisy/db/tab';
import { breaks } from '@daisy/tab-engine';
import { eventCompetition } from './event-competition';

/** The current break is a fold; only a later draw freezes its own input. */
export function eventBreaks(facts: EventCompetitionFacts) {
  const preliminary = facts.stages.filter(
    (stage) => stage.kind === 'preliminary',
  );
  const rounds = facts.rounds.filter((round) =>
    preliminary.some((stage) => stage.id === round.stageId),
  );
  const input = eventCompetition(facts, {
    stageIds: preliminary.map((stage) => stage.id),
    cutoff: Math.max(0, ...rounds.map((round) => round.number)),
    division: null,
    seed: new TextEncoder().encode(facts.configuration.event.id),
  });
  return breaks({
    ...input,
    stages: facts.stages
      .filter((stage) => stage.kind === 'elimination')
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => ({ id: stage.id, division: stage.division })),
    choices: Object.fromEntries(
      facts.entries.flatMap((entry) => {
        const stage = facts.stages.find(
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
}
