import { activeRoomMembers, executeRoomCommand } from '@daisy/debate-engine';
import { createdSides } from '../../room-runtime/created-sides';
import { createAppError } from '@daisy/errors';
import type {
  DrawRoomAssembly,
  DrawWrite,
  LoadedDrawCommand,
} from '@daisy/db/tab';
import type { DrawFacts } from '../commands/draw';
import type { TabPrincipal } from '../tab-principal';
import { eventRoomPins } from './event-room-pins';

type RoomPlan = DrawRoomAssembly['rooms'][number];
/** The exact publication cast enters through the ordinary pure seat transitions. */
export const eventRoomAssemblies = (
  loaded: LoadedDrawCommand,
  facts: DrawFacts,
  writes: readonly DrawWrite[],
  principal: TabPrincipal,
  entropy: string,
  newId: () => string,
): Pick<DrawRoomAssembly, 'rooms' | 'resolutionPin'> => {
  const actorId = principal.actorId;
  if (facts.settings.kind !== 'resolved' || !actorId)
    throw createAppError(
      'INVARIANT',
      'Publication has no resolved Room authority',
    );
  let resolutionPin: DrawRoomAssembly['resolutionPin'] = null;
  const rooms = writes.flatMap((write): RoomPlan[] => {
    if (write.table !== 'rooms' || write.op !== 'insert') return [];
    const fixture = loaded.fixtures.find((row) =>
      writes.some(
        (other) =>
          other.table === 'fixtures' &&
          other.op === 'update' &&
          'roomId' in other.set &&
          other.set.roomId === write.row.id &&
          other.where.id === row.id,
      ),
    );
    if (!fixture)
      throw createAppError(
        'INVARIANT',
        'Published Room has no current fixture',
      );
    const placed = facts.fixtures.find((row) => row.id === fixture.id);
    if (!placed)
      throw createAppError(
        'INVARIANT',
        'Published fixture is not in its actual draw facts',
      );
    const pins = eventRoomPins(loaded, entropy, placed, facts.now);
    if (!pins)
      throw createAppError(
        'INVARIANT',
        'Publication Room pins were not validated',
      );
    if (pins.resolutionPin) resolutionPin = pins.resolutionPin;
    const seats = pins.cast.map((person) => ({
      ...person,
      commandId: newId(),
      participantId: newId(),
    }));
    return [
      {
        room: {
          id: write.row.id,
          hostActorId: null,
          title: write.row.title,
          topic: pins.topic,
          visibility: 'private',
          formatId: write.row.formatId,
          formatVersion: write.row.formatVersion,
          presetVersion: null,
          basis: null,
          competitionType: 'casual',
          // An event Room takes its sides from the draw, never a coin (ADR 0145).
          teamOneSide: createdSides({
            competitionType: 'casual',
            sides: 'fixed',
            castNamesDebater: true,
            seating: pins.rules,
            eventRoom: true,
          }),
          config: pins.config,
          executionPlan: pins.executionPlan,
          rules: pins.rules,
        },
        lobby: { id: write.row.lobbyId, kind: 'tournament' },
        templateId: write.row.templateId,
        ballotDefinition:
          write.row.ballotDefinitionId && write.row.ballotDefinitionVersion
            ? {
                id: write.row.ballotDefinitionId,
                version: write.row.ballotDefinitionVersion,
              }
            : null,
        capture: pins.capture,
        postRoundCall: false,
        now: facts.now,
        caller: { userId: principal.userId, actorId },
        membersOf: (participants) =>
          activeRoomMembers({
            status: 'assembling',
            roundRef: null,
            participants,
          }),
        cast: {
          seats,
          apply: (state, seat, target, now) =>
            executeRoomCommand(
              state,
              seat.actorId,
              {
                type: 'claim-seat',
                commandId: seat.commandId,
                expectedVersion: state.version,
                seat: seat.seat,
              },
              { available: true, readyActorIds: [] },
              {
                now,
                participantId: seat.participantId,
                roundId: null,
                formatId: '',
                hostMaySeatCasualAiJudge: false,
                hostHoldsCasualCapture: false,
                target: target
                  ? {
                      ...target,
                      id: seat.participantId,
                      consentVersion: 0,
                      seat: seat.seat,
                      teamOpen: false,
                      positionOpen: false,
                    }
                  : null,
                drawStart: null,
                seatSeed: null,
              },
            ),
        },
      },
    ];
  });
  return { rooms, resolutionPin };
};
