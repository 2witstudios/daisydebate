import { createAppError } from '@daisy/errors';
import { createRoundRuntime } from '@daisy/debate-engine';
import type { RoundHydration } from '@daisy/db';
import { referenceAiJudge } from '@daisy/db/reference-formats';
import type { RoundStore } from './context';
import { opponentForActor } from './opponents';

/**
 * The hydrated round's runtime, with segment ids minted from the injected
 * generator: every operation drives the same machine whose projection the
 * durable rows persist (ADR 0058 §4).
 */
export const runtimeOf = (round: RoundHydration, nextSegmentId: () => string) =>
  createRoundRuntime({
    round: {
      id: round.id,
      status: round.status,
      currentStage: round.currentStage,
      startedAt: round.startedAt,
      completedAt: round.completedAt,
      outcome: round.outcome,
    },
    rules: round.rules,
    participants: round.participants,
    checkpoint: round.checkpoint,
    segments: round.segments,
    nextSegmentId,
  });

const hasAiCast = (round: RoundHydration, personRole: string) => {
  const opponent = round.participants.find(
    (seat) =>
      seat.role === (personRole === 'affirmative' ? 'negative' : 'affirmative'),
  );
  const judge = round.participants.find((seat) => seat.role === 'judge');
  return (
    opponentForActor(opponent?.actorId) !== null &&
    judge?.actorId === referenceAiJudge.actorId &&
    round.participants.every((seat) => seat.slot === 0)
  );
};

/** Only the member's one-on-one practice cast can be driven by AI orchestration. */
export const ownedBy = async (
  store: RoundStore,
  actorId: string,
  id: string,
  nextSegmentId: () => string,
) => {
  const round = await store.getRound(id);
  if (
    !round ||
    round.competitionType !== 'practice' ||
    round.participants.length !== 3
  )
    throw createAppError('NOT_FOUND');
  const person = round.participants.find(
    (seat) =>
      seat.actorId === actorId &&
      (seat.role === 'affirmative' || seat.role === 'negative'),
  );
  if (!person || !hasAiCast(round, person.role))
    throw createAppError('NOT_FOUND');
  return {
    round,
    runtime: runtimeOf(round, nextSegmentId),
  };
};
