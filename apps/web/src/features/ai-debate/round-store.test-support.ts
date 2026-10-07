import {
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import { createAppError } from '@daisy/errors';
import type { RoundStore } from './context';
import { assemblyMethods } from './round-store-assembly.test-support';
import { createFakeRoundState } from './round-store-state.test-support';
import { usageMethods } from './round-store-usage.test-support';

/**
 * An in-memory RoundStore with the operations' real write semantics — the
 * version check, the command dedupe, the seat uniqueness, the first ballot
 * — so the application operations run their full flows against rows
 * exactly as the adapter would persist them. Nothing here decides domain
 * rules: the operations drive the real runtime. The rows live in
 * `round-store-state.test-support`, and the assembly and usage methods in
 * their own modules; this file holds the round execution and transcript
 * methods that bind them together.
 */
export function createInMemoryRoundStore() {
  const state = createFakeRoundState();

  return {
    /** The fake's clock for tests that assert on recorded instants. */
    tick(ms: number) {
      state.advance(ms);
    },
    roundIds: () => [...state.rounds.keys()],
    commandsApplied: () => state.commandIds.size,
    store: {
      ...assemblyMethods(state),
      ...usageMethods(state),

      async admitAiPractice(
        input: Parameters<RoundStore['admitAiPractice']>[0],
      ) {
        const live = [...state.rounds.values()].filter(
          (round) =>
            (round.status === 'scheduled' || round.status === 'active') &&
            [...state.reservationActors.values()].some((ids) =>
              ids.includes(round.id),
            ),
        ).length;
        if (live >= input.limits.live)
          throw createAppError('RATE_LIMIT', 'Too many live AI debates');
        if (
          (state.reservationActors.get(input.actorId) ?? []).length >=
          input.limits.perDay
        )
          throw createAppError('RATE_LIMIT', 'Daily AI debate limit');
        const assembly = assemblyMethods(state);
        await assembly.createRoom(input.room);
        for (const seat of input.seats)
          await assembly.seatRoomParticipant({
            roomId: input.room.id,
            participantId: seat.id,
            actorId: seat.actorId,
            role: seat.role,
            slot: 0,
          });
        await assembly.startRound({
          roomId: input.room.id,
          roundId: input.roundId,
          resolution: input.resolution,
        });
        await usageMethods(state).reserveAiPractice({
          id: input.reservationId,
          actorId: input.actorId,
          roundId: input.roundId,
        });
      },

      async databaseNow() {
        return new Date(state.now()).toISOString();
      },

      async getRound(id: string) {
        return state.hydrationOf(id);
      },

      async applyRoundExecution(
        input: Parameters<RoundStore['applyRoundExecution']>[0],
      ) {
        const row = state.rounds.get(input.roundId);
        if (!row) throw createAppError('NOT_FOUND', 'No such round');
        if (input.command !== null) {
          if (state.commandIds.has(input.command.commandId))
            throw createAppError('CONFLICT', 'Already applied');
          state.commandIds.add(input.command.commandId);
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
        const rows = state.segments.get(input.roundId) ?? [];
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
        const rows = state.utteranceRows.get(input.roundId);
        if (!rows) throw createAppError('NOT_FOUND', 'No such round');
        rows.push({
          id: input.id,
          roundId: input.roundId,
          segmentId: input.segmentId,
          roundParticipantId: input.roundParticipantId,
          text: input.text,
          complete: input.complete ?? true,
          createdAt: new Date(state.now()),
        });
      },

      async replaceUtterance(
        input: Parameters<RoundStore['replaceUtterance']>[0],
      ) {
        const rows = state.utteranceRows.get(input.roundId) ?? [];
        const row = rows.find((candidate) => candidate.id === input.id);
        if (!row) return;
        row.text = input.text;
        if (input.complete !== undefined) row.complete = input.complete;
      },

      async listRoundUtterances(roundId: string) {
        return (state.utteranceRows.get(roundId) ?? []).map((row) => ({
          id: row.id,
          segmentId: row.segmentId,
          roundParticipantId: row.roundParticipantId,
          text: row.text,
          complete: row.complete,
          createdAt: row.createdAt,
        }));
      },

      async submitBallot(input: Parameters<RoundStore['submitBallot']>[0]) {
        const existing = state.ballotRows.get(input.judgeParticipantId);
        if (existing) return { stored: false };
        state.ballotRows.set(input.judgeParticipantId, {
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
        const row = state.ballotRows.get(judgeParticipantId);
        return row ?? null;
      },

      /**
       * The ballot and the round completion in one step, like the real
       * transaction. The version is checked *first* and nothing is written
       * when it has moved, which is the whole point: the two-commit shape left
       * a ballot on file against a round that was never completed.
       */
      async applyRoundCompletion(
        input: Parameters<RoundStore['applyRoundCompletion']>[0],
      ) {
        const round = state.rounds.get(input.roundId);
        if (!round) throw createAppError('NOT_FOUND', 'No such round');
        if (round.version !== input.expectedVersion)
          throw createAppError('CONFLICT', 'The round moved on');
        const existing = state.ballotRows.get(input.ballot.judgeParticipantId);
        if (existing) throw createAppError('CONFLICT', 'The ballot is on file');
        state.ballotRows.set(input.ballot.judgeParticipantId, {
          id: input.ballot.ballotId,
          judgeParticipantId: input.ballot.judgeParticipantId,
          rubricVersion: input.ballot.ballot.rubricVersion,
          winner: input.ballot.ballot.winner,
          scores: input.ballot.ballot.scores,
          reason: input.ballot.ballot.reason,
          feedback: input.ballot.ballot.feedback,
          status: 'submitted',
        });
        await this.applyRoundExecution({
          roundId: input.roundId,
          expectedVersion: input.expectedVersion,
          command: input.command,
          projection: input.projection,
        });
      },
    },
    aiJudgeActorId: referenceAiJudge.actorId,
    practiceConfig: practiceRoomConfig,
  };
}
