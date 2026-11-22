import { tournamentEntryRatings } from '../../ratings/tournament-entry-ratings';
import type { DrawCommand } from '@daisy/protocol/lobby/draw-command';
import type { LoadedDrawCommand } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import { drawStageSnapshotSchema, type DrawCompetition } from './draw-facts';
import { eventCompetition } from './event-competition';
import { eventBreaks } from './event-breaks';

const frozenStageSchema = z.looseObject({
  stage: drawStageSnapshotSchema,
  breakResultIds: z.array(idSchema),
});

/** A new draw reads current retained facts; subsequent elimination rounds keep the first published stage input. */
export function drawCompetitionAt(
  facts: LoadedDrawCommand,
  addressedDrawId: string | null,
): DrawCompetition {
  const stage = facts.stage;
  if (!stage)
    throw createAppError('INVARIANT', 'The actual draw stage is missing');
  const history = eventCompetition(facts, {
    stageIds: [stage.id],
    cutoff: Math.max(0, facts.round.number - 1),
    division: null,
    seed: new TextEncoder().encode(facts.configuration.event.id),
  }).history;
  const fixtures = history.fixtures.filter(
    (fixture) => fixture.tabRound < facts.round.number,
  );
  const earlier = new Set(fixtures.map((fixture) => fixture.id));
  const common = {
    history: {
      fixtures,
      results: history.results.filter((result) => earlier.has(result.fixture)),
    },
    ratings: tournamentEntryRatings(
      facts.ratingSnapshot,
      facts.configuration.event.id,
      facts.entries.filter(
        (row) => row.eventId === facts.configuration.event.id,
      ),
      facts.members,
    ),
  };
  if (stage.kind === 'preliminary')
    return {
      ...common,
      stage: { kind: 'preliminary' },
      breakChoicesPending: false,
      feederResultsComplete: true,
      breakResultIds: [],
    };
  const addressed = facts.versions.find((draw) => draw.id === addressedDrawId);
  const published =
    addressed ??
    facts.versions
      .flatMap((draw) => {
        if (draw.status !== 'published') return [];
        const round = facts.rounds.find(
          (one) => one.id === draw.tabRoundId && one.stageId === stage.id,
        );
        return round ? [{ draw, number: round.number }] : [];
      })
      .sort((a, b) => a.number - b.number || a.draw.version - b.draw.version)[0]
      ?.draw;
  if (published) {
    const frozen = frozenStageSchema.parse(published.inputs);
    if (
      frozen.stage.kind !== 'elimination' ||
      frozen.stage.division !== stage.division
    )
      throw createAppError(
        'INVARIANT',
        'Published bracket differs from its actual stage',
      );
    return {
      ...common,
      stage: frozen.stage,
      breakChoicesPending: false,
      feederResultsComplete: true,
      breakResultIds: frozen.breakResultIds,
    };
  }
  const current = eventBreaks(facts);
  const seeds =
    current.answer.kind === 'resolved'
      ? current.answer.stages.find((one) => one.stage === stage.id)?.bracket
          .seeds
      : [];
  if (!seeds)
    throw createAppError(
      'INVARIANT',
      'The actual elimination stage has no computed break',
    );
  return {
    ...common,
    stage: {
      kind: 'elimination',
      division: stage.division,
      bracket: { seeds },
    },
    breakChoicesPending: current.answer.kind === 'undecided',
    feederResultsComplete: current.complete,
    breakResultIds: current.resultIds,
  };
}

export function drawCompetition(
  facts: LoadedDrawCommand,
  command: DrawCommand,
): DrawCompetition {
  return drawCompetitionAt(
    facts,
    command.type === 'generate-draw'
      ? null
      : command.type === 'edit-draw'
        ? command.basedOnDrawId
        : command.drawId,
  );
}
