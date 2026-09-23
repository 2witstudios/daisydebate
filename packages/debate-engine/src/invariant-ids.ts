/**
 * Every invariant the engine may reject with, by stable public id. Its own
 * module so the ECS adapter can reject with a registered id without
 * importing the runtime that wraps it. `spec/invariants.json` registers
 * each id with a fixture and a test (`bun invariants`).
 */
export const debateInvariantIds = {
  participantIdentitiesUnique: 'debate.participants.identities-unique',
  participantSeatsUnique: 'debate.participants.seats-unique',
  startedRequiresReadyParticipants:
    'debate.phase.active.requires-ready-participants',
  joiningRequiresWaitingPhase: 'debate.participant.join.waiting-phase',
  readinessRequiresWaitingPhase: 'debate.participant.ready.waiting-phase',
  readinessRequiresJoin: 'debate.participant.ready.requires-join',
  legalPhaseTransition: 'debate.phase.transition.legal',
  completedIsTerminal: 'debate.phase.completed.terminal',
  seatsWithinFormat: 'debate.seats.within-format',
  seatsCapacitySupported: 'debate.seats.capacity-supported',
} as const;
