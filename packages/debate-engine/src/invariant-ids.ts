/**
 * Every invariant the engine may reject with, by stable public id. Its own
 * module so the runtime and adapters can reject with a registered id
 * without importing the compositions that wrap them. `spec/invariants.json`
 * registers each id with a fixture and a test (`bun invariants`).
 */
export const debateInvariantIds = {
  completedIsTerminal: 'round.status.completed.terminal',
  segmentMatchesRules: 'round.segment.matches-rules',
  liveOpenSegmentCount: 'round.live.open-segment-count',
  seatCompleteness: 'round.seats.complete',
  prepRequiresCapability: 'round.prep.requires-capability',
  prepRequiresSpendableSegment: 'round.prep.requires-spendable-segment',
  prepRequiresBudget: 'round.prep.requires-budget',
  startSpeechRequiresPrep: 'round.speech.requires-prep',
  yieldRequiresFloor: 'round.yield.requires-floor',
  interruptRequiresPolicy: 'round.interrupt.requires-policy',
  completeAfterFinalSegment: 'round.complete.after-final-segment',
  ratingStateBounded: 'debate.rating.state-bounded',
  ratingVolatilityConverges: 'debate.rating.volatility-converges',
} as const;
