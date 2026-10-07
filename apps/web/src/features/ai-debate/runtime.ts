import { createAppError } from '@daisy/errors';
import { createRoundRuntime } from '@daisy/debate-engine';
import type { RoundHydration } from '@daisy/db';
import type { RoundStore } from './context';

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

/** The actor's own round — the actor holds a seat — or NOT_FOUND. */
export const ownedBy = async (
  store: RoundStore,
  actorId: string,
  id: string,
  nextSegmentId: () => string,
) => {
  const round = await store.getRound(id);
  if (
    !round ||
    !round.participants.some(
      (seat) =>
        seat.actorId === actorId &&
        (seat.role === 'affirmative' || seat.role === 'negative'),
    )
  )
    throw createAppError('NOT_FOUND');
  return {
    round,
    runtime: runtimeOf(round, nextSegmentId),
  };
};
