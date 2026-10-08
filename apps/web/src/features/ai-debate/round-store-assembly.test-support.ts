import { oneOnOneDefinition } from '@daisy/db/reference-formats';
import { createAppError } from '@daisy/errors';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
import type { RoundStore } from './context';
import type { FakeRoundState } from './round-store-state.test-support';

/**
 * The assembly half of the fake store: the format lookup and the Room
 * lifecycle — create, seat, freeze into a Round — with the real seat
 * uniqueness and completeness semantics and none of the persistence.
 */
export const assemblyMethods = (state: FakeRoundState) => ({
  async getFormat(id: string) {
    if (id !== 'one-on-one') return null;
    return {
      id,
      name: 'One-on-one',
      version: 1,
      definition: oneOnOneDefinition,
    };
  },

  async createRoom(room: Parameters<RoundStore['createRoom']>[0]) {
    if (state.rooms.has(room.id))
      throw createAppError('CONFLICT', 'The room already exists');
    state.rooms.set(room.id, {
      formatId: room.formatId,
      formatVersion: room.formatVersion,
      presetVersion: room.presetVersion,
      competitionType: room.competitionType,
      length: room.length,
      rules: room.rules,
      status: 'assembling',
      seats: [],
    });
    return {
      id: room.id,
      formatId: room.formatId,
      formatVersion: room.formatVersion,
      presetVersion: room.presetVersion,
      competitionType: room.competitionType,
      length: room.length,
      status: 'assembling',
      rules: room.rules,
    };
  },

  async seatRoomParticipant(
    input: Parameters<RoundStore['seatRoomParticipant']>[0],
  ) {
    const room = state.rooms.get(input.roomId);
    if (!room) throw createAppError('NOT_FOUND', 'No such room');
    if (room.status !== 'assembling' && room.status !== 'ready')
      throw createAppError('CONFLICT', 'The room has started');
    if (
      room.seats.some((seat) => seat.actorId === input.actorId) ||
      room.seats.some(
        (seat) => seat.role === input.role && seat.slot === input.slot,
      )
    )
      throw createAppError('CONFLICT', 'Already seated');
    room.seats = [
      ...room.seats,
      {
        id: input.participantId,
        actorId: input.actorId,
        role: input.role,
        slot: input.slot,
      },
    ];
    room.status = 'ready';
  },

  async startRound(input: Parameters<RoundStore['startRound']>[0]) {
    const room = state.rooms.get(input.roomId);
    if (!room) throw createAppError('NOT_FOUND', 'No such room');
    if (room.status !== 'ready')
      throw createAppError('CONFLICT', 'Only a ready room starts');
    for (const [role, wanted] of Object.entries(room.rules.seats)) {
      const held = room.seats
        .filter((seat) => seat.role === role)
        .map((seat) => seat.slot)
        .sort((a, b) => a - b);
      if (
        held.length !== wanted ||
        !held.every((slot, index) => slot === index)
      )
        throw createAppError('INVARIANT', 'Incomplete seats');
    }
    const ladder =
      room.competitionType === 'ranked'
        ? room.length === 'full'
          ? 'ranked'
          : 'quick'
        : null;
    state.rounds.set(input.roundId, {
      id: input.roundId,
      roomId: input.roomId,
      resolution: input.resolution,
      competitionType: room.competitionType,
      length: room.length,
      formatId: room.formatId,
      formatVersion: room.formatVersion,
      presetVersion: room.presetVersion,
      rules: room.rules,
      status: 'scheduled',
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
      checkpoint: emptyRuntimeCheckpoint,
      version: 1,
    });
    state.participants.set(input.roundId, room.seats);
    state.segments.set(input.roundId, []);
    state.utteranceRows.set(input.roundId, []);
    room.status = 'started';
    void ladder;
  },
});
