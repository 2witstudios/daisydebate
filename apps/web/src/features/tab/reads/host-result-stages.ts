import type { HostResultsFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { isRoundRunning, isRoundOver } from '@daisy/protocol';
import type { HostResultsView } from '@daisy/protocol/lobby/results-read';
import { z } from 'zod';
import { drawStageSnapshotSchema } from '../operations/draw-facts';
import { projectResultCompetition } from '../commands/result-projection';
type OfficialStage = Extract<
  HostResultsView['stages'][number],
  { visibility: 'official' }
>;
type OfficialFixture = OfficialStage['tabRounds'][number]['fixtures'][number];
const frozenStage = z.looseObject({ stage: drawStageSnapshotSchema });
export function hostResultStages(
  facts: HostResultsFacts,
): HostResultsView['stages'] {
  const competition = facts.competition;
  const current = competition.results.filter(
    (row) =>
      !competition.results.some((other) => other.supersedesResultId === row.id),
  );
  return [...competition.stages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage): OfficialStage => {
      const rounds = competition.rounds
        .filter((round) => round.stageId === stage.id)
        .sort((a, b) => a.number - b.number);
      const publishedDraw = competition.draws
        .filter(
          (draw) =>
            draw.status === 'published' &&
            rounds.some((round) => round.id === draw.tabRoundId),
        )
        .sort(
          (a, b) =>
            rounds.find((round) => round.id === a.tabRoundId)!.number -
              rounds.find((round) => round.id === b.tabRoundId)!.number ||
            a.version - b.version,
        )[0];
      const snapshot = publishedDraw
        ? frozenStage.parse(publishedDraw.inputs).stage
        : null;
      const seeds =
        snapshot?.kind === 'elimination' ? snapshot.bracket.seeds : [];
      return {
        lobbyId: competition.configuration.lobby.id,
        eventId: competition.configuration.event.id,
        stageId: stage.id,
        kind: stage.kind,
        division: stage.division,
        visibility: 'official',
        tabRounds: rounds.map((round) => {
          const fixtures = competition.fixtures
            .filter(
              (fixture) =>
                fixture.tabRoundId === round.id &&
                fixture.status === 'published',
            )
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((fixture): OfficialFixture => {
              const result = current.find(
                (row) => row.fixtureId === fixture.id,
              );
              const projection = result
                ? projectResultCompetition(result.competitionRecord, {
                    id: result.id,
                    fixture: fixture.id,
                    supersedes: result.supersedesResultId,
                    certified: competition.certified.some(
                      (one) => one.resultId === result.id,
                    ),
                  })
                : null;
              if (projection?.kind === 'refused')
                throw createAppError(
                  'INVARIANT',
                  'Stored competitive result cannot be projected',
                );
              const roomRound = facts.currentRounds.find(
                (one) => one.roomId === fixture.roomId,
              );
              const room = facts.rooms.find((one) => one.id === fixture.roomId);
              return {
                fixtureId: fixture.id,
                entries: competition.fixtureEntries
                  .filter((one) => one.fixtureId === fixture.id)
                  .sort((a, b) => a.position - b.position)
                  .map((one) => {
                    const seed = seeds.indexOf(one.entryId);
                    return {
                      entryId: one.entryId,
                      seed: seed === -1 ? null : seed + 1,
                      shown: {
                        kind: 'name',
                        name: competition.entries.find(
                          (entry) => entry.id === one.entryId,
                        )!.name,
                      },
                    };
                  }),
                state:
                  result && projection?.kind === 'projected'
                    ? {
                        kind: 'decided',
                        resultId: result.id,
                        outcomes: [...projection.projection.entries],
                      }
                    : roomRound && isRoundRunning(roomRound.status) && room
                      ? {
                          kind: 'live',
                          room: { roomId: room.id, name: room.title },
                          watchable: false,
                        }
                      : roomRound && isRoundOver(roomRound.status)
                        ? { kind: 'awaiting_result' }
                        : { kind: 'scheduled' },
              };
            });
          return {
            tabRoundId: round.id,
            name: round.name ?? `Round ${round.number}`,
            status:
              fixtures.length &&
              fixtures.every((fixture) => fixture.state.kind === 'decided')
                ? 'complete'
                : fixtures.some(
                      (fixture) =>
                        fixture.state.kind === 'live' ||
                        fixture.state.kind === 'awaiting_result',
                    )
                  ? 'running'
                  : 'scheduled',
            startsAt:
              facts.slots
                .find((slot) => slot.id === round.timeSlotId)
                ?.startsAt.toISOString() ?? null,
            waitsOn: null,
            fixtures,
          };
        }),
      };
    });
}
