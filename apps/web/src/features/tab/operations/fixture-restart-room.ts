import { activeRoomMembers, executeRoomCommand } from '@daisy/debate-engine';
import { createdSides } from '../../room-runtime/created-sides';
import { createAppError } from '@daisy/errors';
import type { LoadedFixtureCommand, FixtureOwnerEffects } from '@daisy/db/tab';
import type { TabPrincipal } from '../tab-principal';

/** Restart carries the old published pins and current cast; all identities and Ready consent begin anew. */
export function fixtureRestartRoom(
  loaded: LoadedFixtureCommand,
  principal: TabPrincipal,
  roomId: string,
  newId: () => string,
): FixtureOwnerEffects['restart'] {
  const { room } = loaded.context,
    state = loaded.roomState;
  if (!room || !state || !principal.actorId) throw createAppError('INVARIANT');
  return {
    room: {
      id: roomId,
      hostActorId: null,
      title: room.title,
      topic: room.topic,
      visibility: room.visibility,
      formatId: room.formatId,
      formatVersion: room.formatVersion,
      presetVersion: room.presetVersion,
      basis:
        room.basisFormatId && room.basisPresetVersion
          ? {
              formatId: room.basisFormatId,
              presetVersion: room.basisPresetVersion,
            }
          : null,
      competitionType: room.competitionType,
      // A restarted event Room keeps the draw's sides (ADR 0145).
      teamOneSide: createdSides({
        competitionType: room.competitionType,
        sides: 'fixed',
        castNamesDebater: true,
        seating: room.rulesSnapshot,
        eventRoom: true,
      }),
      config: room.config,
      executionPlan: room.executionPlan,
      rules: room.rulesSnapshot,
    },
    lobby: { id: loaded.context.fixture.lobbyId, kind: 'tournament' },
    templateId: room.templateId,
    ballotDefinition:
      room.ballotDefinitionId && room.ballotDefinitionVersion
        ? { id: room.ballotDefinitionId, version: room.ballotDefinitionVersion }
        : null,
    capture: room.capture,
    postRoundCall: room.postRoundCall,
    now: loaded.checkedAt,
    caller: { userId: principal.userId, actorId: principal.actorId },
    membersOf: (participants) =>
      activeRoomMembers({ status: 'assembling', roundRef: null, participants }),
    cast: {
      seats: state.participants.map((person) => ({
        actorId: person.actorId,
        seat: person.seat,
        commandId: newId(),
        participantId: newId(),
      })),
      apply: (before, seat, target, now) =>
        executeRoomCommand(
          before,
          seat.actorId,
          {
            type: 'claim-seat',
            commandId: seat.commandId,
            expectedVersion: before.version,
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
  };
}
