import { activeRoomMembers, executeRoomCommand } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { sideSeat, judgeSeat, type SeatRef } from '@daisy/protocol';
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
    const pins = eventRoomPins(loaded, entropy, fixture.id, facts.now);
    if (!pins)
      throw createAppError(
        'INVARIANT',
        'Publication Room pins were not validated',
      );
    if (pins.resolutionPin) resolutionPin = pins.resolutionPin;
    const placed = facts.fixtures.find((row) => row.id === fixture.id);
    if (!placed)
      throw createAppError(
        'INVARIANT',
        'Published fixture is not in its actual draw facts',
      );
    const debaters = [...placed.entries]
      .sort((a, b) => a.position - b.position)
      .flatMap((entry) =>
        entry.members.map((actorId, slot) => {
          const side = pins.definition.sides[entry.position];
          if (placed.kind !== 'section' && !side)
            throw createAppError(
              'INVARIANT',
              'A published pairing has no declared side',
            );
          const seat: SeatRef =
            placed.kind === 'section'
              ? { kind: 'speaker', slot: entry.position + slot }
              : sideSeat(side!.key, slot);
          return { actorId, seat, commandId: newId(), participantId: newId() };
        }),
      );
    const judges = [...placed.judges]
      .sort((a, b) => Number(b.chair) - Number(a.chair))
      .map((judge, slot) => ({
        actorId: judge.person,
        seat: judgeSeat(slot),
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
          seats: [...debaters, ...judges],
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
                    }
                  : null,
                drawStart: null,
              },
            ),
        },
      },
    ];
  });
  return { rooms, resolutionPin };
};
