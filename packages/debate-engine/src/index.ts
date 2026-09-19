import { createAppError } from '@daisy/errors';
import {
  debateSnapshotSchema,
  type DebateSnapshot,
  type Participant,
  type DebatePhase,
} from '@daisy/protocol';
import { createAdapter } from './ecs-adapter';
export type { DebateSnapshot, Participant, DebatePhase } from '@daisy/protocol';
export type DebateRuntime = {
  snapshot(): DebateSnapshot;
  join(participant: { participantId: string; side: Participant['side'] }): void;
  markReady(participantId: string): void;
  transition(phase: DebatePhase): void;
  dispose(): void;
};
function validateSnapshot(input: unknown): DebateSnapshot {
  const result = debateSnapshotSchema.safeParse(input);
  if (!result.success)
    throw createAppError('VALIDATION', 'Invalid debate snapshot', result.error);
  const snapshot = result.data;
  const { participants, phase } = snapshot;
  if (
    new Set(participants.map((p) => p.id)).size !== participants.length ||
    new Set(participants.map((p) => p.side)).size !== participants.length
  )
    throw createAppError(
      'INVARIANT',
      'Participant identities and competitive sides must be unique',
    );
  if (
    phase !== 'waiting' &&
    (participants.length !== 2 || participants.some((p) => !p.ready))
  )
    throw createAppError(
      'INVARIANT',
      'Started debates require two ready participants',
    );
  return snapshot;
}
/** Restore our versioned JSON representation, never an Adobe-private snapshot. */
export function restoreDebateRuntime(input: unknown): DebateRuntime {
  const adapter = createAdapter(validateSnapshot(input));
  return {
    snapshot: adapter.snapshot,
    join({ participantId, side }) {
      const snapshot = adapter.snapshot();
      if (snapshot.phase !== 'waiting')
        throw createAppError('INVARIANT', 'Joining requires waiting phase');
      const candidate = { id: participantId, side, ready: false };
      validateSnapshot({
        ...snapshot,
        participants: [...snapshot.participants, candidate],
      });
      adapter.join(candidate);
    },
    markReady(participantId) {
      if (adapter.snapshot().phase !== 'waiting')
        throw createAppError('INVARIANT', 'Readiness requires waiting phase');
      adapter.markReady(participantId);
    },
    transition(phase) {
      const snapshot = adapter.snapshot();
      const legal =
        (snapshot.phase === 'waiting' && phase === 'active') ||
        (snapshot.phase === 'active' && phase === 'completed');
      if (!legal)
        throw createAppError('INVARIANT', 'Illegal debate phase transition');
      validateSnapshot({ ...snapshot, phase });
      adapter.transition(phase);
    },
    dispose: adapter.dispose,
  };
}
/** IDs and time are injected by the application; the engine has no ambient clock. */
export function createDebateRuntime(input: {
  id: string;
  resolution: string;
  createdAt: string;
}): DebateRuntime {
  return restoreDebateRuntime({
    ...input,
    version: 1,
    format: 'foundation',
    phase: 'waiting',
    participants: [],
  });
}
