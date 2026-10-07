import type { RoundHydration } from '@daisy/db';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import { createAppError } from '@daisy/errors';
import {
  emptyRuntimeCheckpoint,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import type { RoundStore } from './context';

/**
 * An in-memory RoundStore with the operations' real write semantics — the
 * version check, the command dedupe, the seat uniqueness, the first ballot
 * — so the application operations run their full flows against rows
 * exactly as the adapter would persist them. Nothing here decides domain
 * rules: the operations drive the real runtime.
 */
export function createInMemoryRoundStore() {
  type RoundRow = {
    id: string;
    roomId: string | null;
    resolution: string;
    competitionType: 'ranked' | 'casual' | 'practice';
    length: 'full' | 'quick';
    formatId: string;
    formatVersion: number;
    presetVersion: number | null;
    rules: RoundHydration['rules'];
    status: RoundHydration['status'];
    currentStage: RoundHydration['currentStage'];
    startedAt: string | null;
    completedAt: string | null;
    outcome: RoundHydration['outcome'];
    checkpoint: RuntimeCheckpoint;
    version: number;
  };
  const rooms = new Map<
    string,
    {
      formatId: string;
      formatVersion: number;
      presetVersion: number | null;
      competitionType: 'ranked' | 'casual' | 'practice';
      length: 'full' | 'quick';
      rules: RoundHydration['rules'];
      status: 'assembling' | 'ready' | 'started' | 'abandoned';
      seats: RoundHydration['participants'];
    }
  >();
  const rounds = new Map<string, RoundRow>();
  const participants = new Map<string, RoundHydration['participants']>();
  const segments = new Map<
    string,
    Array<{
      id: string;
      sequence: number;
      type: 'speech' | 'cross_ex';
      rulesSegmentKey: string;
      startedAt: string;
      endedAt: string | null;
      durationMs: number;
    }>
  >();
  const utteranceRows = new Map<
    string,
    {
      id: string;
      roundId: string;
      segmentId: string;
      roundParticipantId: string;
      text: string;
      complete: boolean;
      createdAt: Date;
    }[]
  >();
  const ballotRows = new Map<
    string,
    {
      id: string;
      judgeParticipantId: string;
      rubricVersion: string;
      winner: string;
      scores: unknown;
      reason: string;
      feedback: unknown;
      status: 'submitted' | 'voided';
    }
  >();
  const commandIds = new Set<string>();
  const runRows: {
    id: string;
    roundParticipantId: string;
    kind: string;
    characters: number;
  }[] = [];
  const reservationActors = new Map<string, string[]>();
  let now = 0;

  const hydrationOf = (roundId: string): RoundHydration | null => {
    const row = rounds.get(roundId);
    if (!row) return null;
    return {
      id: row.id,
      formatId: row.formatId,
      formatVersion: row.formatVersion,
      resolution: row.resolution,
      status: row.status,
      currentStage: row.currentStage,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      outcome: row.outcome,
      rules: row.rules,
      checkpoint: row.checkpoint,
      version: row.version,
      participants: participants.get(roundId) ?? [],
      segments: segments.get(roundId) ?? [],
    };
  };

  return {
    /** The fake's clock for tests that assert on recorded instants. */
    tick(ms: number) {
      now += ms;
    },
    roundIds: () => [...rounds.keys()],
    commandsApplied: () => commandIds.size,
    store: {
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
        if (rooms.has(room.id))
          throw createAppError('CONFLICT', 'The room already exists');
        rooms.set(room.id, {
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
        const room = rooms.get(input.roomId);
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
        const room = rooms.get(input.roomId);
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
        rounds.set(input.roundId, {
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
        participants.set(input.roundId, room.seats);
        segments.set(input.roundId, []);
        utteranceRows.set(input.roundId, []);
        room.status = 'started';
        void ladder;
      },

      async databaseNow() {
        return new Date(now).toISOString();
      },

      async getRound(id: string) {
        return hydrationOf(id);
      },

      async applyRoundExecution(
        input: Parameters<RoundStore['applyRoundExecution']>[0],
      ) {
        const row = rounds.get(input.roundId);
        if (!row) throw createAppError('NOT_FOUND', 'No such round');
        if (input.command !== null) {
          if (commandIds.has(input.command.commandId))
            throw createAppError('CONFLICT', 'Already applied');
          commandIds.add(input.command.commandId);
        }
        if (row.version !== input.expectedVersion)
          throw createAppError('CONFLICT', 'The round moved on');
        const { projection } = input;
        if (projection.round !== null) {
          row.status = projection.round.status;
          row.currentStage = projection.round.currentStage;
          row.startedAt = projection.round.startedAt;
          row.completedAt = projection.round.completedAt;
          row.outcome = projection.round.outcome;
          row.checkpoint = projection.round.checkpoint;
        }
        const rows = segments.get(input.roundId) ?? [];
        for (const insert of projection.segmentInserts)
          rows.push({
            id: insert.id,
            sequence: insert.sequence,
            type: insert.type,
            rulesSegmentKey: insert.rulesSegmentKey,
            startedAt: insert.startedAt,
            endedAt: null,
            durationMs: insert.durationMs,
          });
        for (const close of projection.segmentCloses) {
          const rowSegment = rows.find((segment) => segment.id === close.id);
          if (rowSegment) rowSegment.endedAt = close.endedAt;
        }
        row.version += 1;
      },

      async appendUtterance(
        input: Parameters<RoundStore['appendUtterance']>[0],
      ) {
        const rows = utteranceRows.get(input.roundId);
        if (!rows) throw createAppError('NOT_FOUND', 'No such round');
        rows.push({
          id: input.id,
          roundId: input.roundId,
          segmentId: input.segmentId,
          roundParticipantId: input.roundParticipantId,
          text: input.text,
          complete: input.complete ?? true,
          createdAt: new Date(now),
        });
      },

      async replaceUtterance(
        input: Parameters<RoundStore['replaceUtterance']>[0],
      ) {
        const rows = utteranceRows.get(input.roundId) ?? [];
        const row = rows.find((candidate) => candidate.id === input.id);
        if (!row) return;
        row.text = input.text;
        if (input.complete !== undefined) row.complete = input.complete;
      },

      async listRoundUtterances(roundId: string) {
        return (utteranceRows.get(roundId) ?? []).map((row) => ({
          id: row.id,
          segmentId: row.segmentId,
          roundParticipantId: row.roundParticipantId,
          text: row.text,
          complete: row.complete,
          createdAt: row.createdAt,
        }));
      },

      async submitBallot(input: Parameters<RoundStore['submitBallot']>[0]) {
        const existing = ballotRows.get(input.judgeParticipantId);
        if (existing) return { stored: false };
        ballotRows.set(input.judgeParticipantId, {
          id: input.ballotId,
          judgeParticipantId: input.judgeParticipantId,
          rubricVersion: input.ballot.rubricVersion,
          winner: input.ballot.winner,
          scores: input.ballot.scores,
          reason: input.ballot.reason,
          feedback: input.ballot.feedback,
          status: 'submitted',
        });
        return { stored: true };
      },

      async getBallot(judgeParticipantId: string) {
        const row = ballotRows.get(judgeParticipantId);
        return row ?? null;
      },

      async recordAgentRun(input: Parameters<RoundStore['recordAgentRun']>[0]) {
        runRows.push({
          id: input.id,
          roundParticipantId: input.roundParticipantId,
          kind: input.kind,
          characters: input.characters ?? 0,
        });
      },

      async spokenCharactersFor(input: { roundParticipantId: string }) {
        return runRows
          .filter(
            (row) =>
              row.roundParticipantId === input.roundParticipantId &&
              row.kind === 'tts',
          )
          .reduce((sum, row) => sum + row.characters, 0);
      },

      async reserveAiPractice(input: {
        id: string;
        actorId: string;
        roundId: string;
      }) {
        const held = reservationActors.get(input.actorId) ?? [];
        reservationActors.set(input.actorId, [...held, input.roundId]);
      },

      async markReservationCounted(_input: {
        actorId: string;
        roundId: string;
      }) {},

      async countRecentAiPractice(input: { actorId: string }) {
        return (reservationActors.get(input.actorId) ?? []).length;
      },
    },
    aiJudgeActorId: referenceAiJudge.actorId,
    practiceConfig: practiceRoomConfig,
  };
}
