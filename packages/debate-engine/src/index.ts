import { createAppError, createInvariantError } from '@daisy/errors';
import {
  debateRoles,
  debateSnapshotSchema,
  type DebateSnapshot,
  type FormatRules,
  type Participant,
  type DebatePhase,
} from '@daisy/protocol';
import { createAdapter } from './ecs-adapter';
export type {
  DebateSnapshot,
  FormatRules,
  Participant,
  DebatePhase,
} from '@daisy/protocol';
export type DebateRuntime = {
  snapshot(): DebateSnapshot;
  join(participant: { participantId: string; side: Participant['side'] }): void;
  markReady(participantId: string): void;
  transition(phase: DebatePhase): void;
  dispose(): void;
};
export const debateInvariantIds = {
  participantIdentitiesUnique: 'debate.participants.identities-unique',
  participantSeatsUnique: 'debate.participants.seats-unique',
  startedRequiresReadyParticipants:
    'debate.phase.active.requires-ready-participants',
  joiningRequiresWaitingPhase: 'debate.participant.join.waiting-phase',
  readinessRequiresWaitingPhase: 'debate.participant.ready.waiting-phase',
  legalPhaseTransition: 'debate.phase.transition.legal',
  completedIsTerminal: 'debate.phase.completed.terminal',
  seatsWithinFormat: 'debate.seats.within-format',
} as const;
/**
 * True when `rules` are exactly the canonical rules of the format (key order
 * ignored). A ranked debate must run under canonical rules (ADR 0030); a
 * lobby may override them, and then its result never reaches the ladder.
 */
export function rulesMatchFormat(
  rules: FormatRules,
  canonical: FormatRules,
): boolean {
  return (
    rules.version === canonical.version &&
    debateRoles.every((role) => rules.seats[role] === canonical.seats[role]) &&
    rules.clock.speechMs === canonical.clock.speechMs &&
    rules.clock.prepMs === canonical.clock.prepMs
  );
}
function validateSnapshot(input: unknown): DebateSnapshot {
  const result = debateSnapshotSchema.safeParse(input);
  if (!result.success)
    throw createAppError('VALIDATION', 'Invalid debate snapshot', result.error);
  const snapshot = result.data;
  const { participants, phase, rules } = snapshot;
  if (new Set(participants.map((p) => p.id)).size !== participants.length)
    throw createInvariantError(
      debateInvariantIds.participantIdentitiesUnique,
      'Participant identities must be unique',
    );
  if (new Set(participants.map((p) => p.side)).size !== participants.length)
    throw createInvariantError(
      debateInvariantIds.participantSeatsUnique,
      'Participant seats must be unique',
    );
  // After uniqueness: a duplicate seat is reported as such, not as capacity.
  for (const side of ['affirmative', 'negative'] as const)
    if (participants.filter((p) => p.side === side).length > rules.seats[side])
      throw createInvariantError(
        debateInvariantIds.seatsWithinFormat,
        `The format offers ${rules.seats[side]} ${side} seat(s)`,
      );
  if (
    phase !== 'waiting' &&
    (participants.length !== 2 || participants.some((p) => !p.ready))
  )
    throw createInvariantError(
      debateInvariantIds.startedRequiresReadyParticipants,
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
        throw createInvariantError(
          debateInvariantIds.joiningRequiresWaitingPhase,
          'Joining requires waiting phase',
        );
      const candidate = { id: participantId, side, ready: false };
      validateSnapshot({
        ...snapshot,
        participants: [...snapshot.participants, candidate],
      });
      adapter.join(candidate);
    },
    markReady(participantId) {
      if (adapter.snapshot().phase !== 'waiting')
        throw createInvariantError(
          debateInvariantIds.readinessRequiresWaitingPhase,
          'Readiness requires waiting phase',
        );
      adapter.markReady(participantId);
    },
    transition(phase) {
      const snapshot = adapter.snapshot();
      if (snapshot.phase === 'completed')
        throw createInvariantError(
          debateInvariantIds.completedIsTerminal,
          'Completed debates are terminal',
        );
      const legal =
        (snapshot.phase === 'waiting' && phase === 'active') ||
        (snapshot.phase === 'active' && phase === 'completed');
      if (!legal)
        throw createInvariantError(
          debateInvariantIds.legalPhaseTransition,
          'Illegal debate phase transition',
        );
      validateSnapshot({ ...snapshot, phase });
      adapter.transition(phase);
    },
    dispose: adapter.dispose,
  };
}
/**
 * IDs and time are injected by the application; the engine has no ambient
 * clock. `format` is the canonical slug and `rules` the effective rules this
 * debate runs under (ADR 0030); the caller loads them from the format row and
 * applies any lobby overrides before construction.
 */
export function createDebateRuntime(input: {
  id: string;
  resolution: string;
  createdAt: string;
  format: string;
  rules: FormatRules;
}): DebateRuntime {
  return restoreDebateRuntime({
    ...input,
    version: 1,
    phase: 'waiting',
    participants: [],
  });
}
