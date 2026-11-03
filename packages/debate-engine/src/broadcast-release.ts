import type { BroadcastReleasePolicy } from '@daisy/protocol';

/**
 * When a Broadcast may release its media and audience facts. The delay is a
 * floor: nothing here releases early, and facts follow media actually released,
 * never the clock (ADR 0099). Pure: time arrives as an argument.
 */
export type HeldSegment = {
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * The one trusted value for a ranked Round's delay, read by the hold and the
 * timeline alike. Lowering it is this one line; nothing else names the number.
 */
export const RANKED_DELAY_SECONDS = 60;
/** How far real delay may run past the policy before it alerts (DEC-303). */
const DELAY_ALERT_MARGIN_SECONDS = 30;

const standardDelay: BroadcastReleasePolicy = {
  kind: 'delay',
  seconds: RANKED_DELAY_SECONDS,
};

/** Ranked is fixed for competitive integrity; a casual host's choice stands. */
export const resolveReleasePolicy = (
  competitionType: 'ranked' | 'casual',
  hostChoice: BroadcastReleasePolicy | null,
): BroadcastReleasePolicy =>
  competitionType === 'ranked' ? standardDelay : (hostChoice ?? standardDelay);

const segmentEnd = (segment: HeldSegment) =>
  segment.capturedAtMs + segment.durationMs;

export const segmentDue = (
  policy: BroadcastReleasePolicy,
  segment: HeldSegment,
  facts: { readonly nowMs: number; readonly roundEndedAtMs: number | null },
): boolean => {
  const complete = facts.nowMs >= segmentEnd(segment);
  switch (policy.kind) {
    case 'delay':
      return facts.nowMs >= segmentEnd(segment) + policy.seconds * 1000;
    case 'round_end':
      return (
        complete &&
        facts.roundEndedAtMs !== null &&
        facts.nowMs >= facts.roundEndedAtMs
      );
    case 'at':
      return complete && facts.nowMs >= policy.atMs;
  }
};

/** The next durable watermark once a segment is published; it never recedes. */
export const releasedThrough = (
  current: number | null,
  released: HeldSegment,
): number => Math.max(current ?? 0, segmentEnd(released));

/** A fact leaves only once released media has passed it, plus viewer latency. */
export const factReleased = (
  capturedAtMs: number,
  watermarkMs: number | null,
  options: { readonly marginMs: number },
): boolean =>
  watermarkMs !== null && watermarkMs >= capturedAtMs + options.marginMs;

/** Real delay past the recorded bound; the hold stays behind and alerts. */
export const delayAlert = (
  watermarkMs: number,
  nowMs: number,
  options: { readonly policySeconds: number } = {
    policySeconds: RANKED_DELAY_SECONDS,
  },
): boolean =>
  nowMs - watermarkMs >
  (options.policySeconds + DELAY_ALERT_MARGIN_SECONDS) * 1000;

/**
 * Debaters reading a Broadcast's chat during the Round: never on ranked, and on
 * non-ranked Rounds on unless the host turned it off. Stored per Broadcast.
 */
export const debatersReadChat = (
  competitionType: 'ranked' | 'casual',
  hostAllows: boolean,
): boolean => competitionType !== 'ranked' && hostAllows;
