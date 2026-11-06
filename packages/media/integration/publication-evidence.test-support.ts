import { createPublicationObserver } from '../src/publication-observation';
import type { createPacedAudioWriter } from '../src/paced-publication';
import type { publicationClock } from '../src/publication-clock';
import { assert } from 'riteway/bun';

type Observer = ReturnType<typeof createPublicationObserver>;
type Observation = Parameters<
  Parameters<typeof createPublicationObserver>[0]
>[0];
type Result = Awaited<ReturnType<ReturnType<typeof createPacedAudioWriter>>>;
type Rejection = Extract<
  ReturnType<typeof publicationClock>,
  { valid: false }
>['rejection'];
type Expected = Rejection | 'complete' | 'refused' | 'cancelled' | 'stall';
type Snapshot = {
  readonly delivery: ReturnType<Observer['status']>;
  readonly events: readonly Observation[];
};
type Assessment =
  | { readonly state: 'confirmed'; readonly decision: Expected }
  | { readonly state: 'incomplete' | 'invalid'; readonly reason: string };

/** Evidence protocol only: clock predicates exist solely in publication-clock. */
export function assessNativePublicationEvidence(
  snapshot: Snapshot,
  result: Result,
  expected: Expected,
): Assessment {
  const incomplete = (reason: string): Assessment => ({
    state: 'incomplete',
    reason,
  });
  const invalid = (reason: string): Assessment => ({
    state: 'invalid',
    reason,
  });
  if (!snapshot || !Array.isArray(snapshot.events) || !snapshot.delivery)
    return invalid('malformed');
  const { events, delivery } = snapshot;
  if (delivery.state === 'invalid')
    return invalid(`delivery.${delivery.reason}`);
  if (delivery.state !== 'valid') return invalid('malformed-delivery');
  if (events.length === 0) return incomplete('not-observed');
  if (delivery.delivered !== events.length) return incomplete('missing-record');
  const kinds = [
    'clock',
    'receipt',
    'cadence',
    'authorization',
    'cancellation',
    'terminal',
  ];
  if (
    events.some(
      (event, sequence) =>
        !event ||
        !kinds.includes(event.kind) ||
        event.sequence !== sequence ||
        !Object.values(event).every(
          (value) =>
            value === null ||
            typeof value === 'string' ||
            (typeof value === 'number' && Number.isFinite(value)),
        ),
    )
  )
    return invalid('record-order-or-shape');
  const first = events[0]!;
  if (first.kind !== 'clock' || first.phase !== 'initial')
    return incomplete('missing-initial');
  const terminals = events.filter((event) => event.kind === 'terminal');
  if (terminals.length === 0) return incomplete('missing-terminal');
  if (terminals.length !== 1 || events.at(-1) !== terminals[0])
    return invalid('terminal-order');
  const terminal = terminals[0]!;
  if (
    terminal.eligibleSamples !== result.eligibleSamples ||
    terminal.complete !== (result.complete ? 1 : 0) ||
    terminal.segmentEnded !== (result.segmentEnded ? 1 : 0) ||
    terminal.stop !== result.stop
  )
    return invalid('terminal-result-mismatch');
  const receipts = events.filter((event) => event.kind === 'receipt');
  const windows = events.filter((event) => event.kind === 'authorization');
  const rejected = events.find(
    (event) =>
      (event.kind === 'clock' || event.kind === 'receipt') &&
      event.decision !== 'accepted',
  );
  let actual: Expected;
  if (result.complete) {
    if (
      result.eligibleSamples !== 9600 ||
      result.stop !== null ||
      result.segmentEnded ||
      terminal.cancelled !== 0
    )
      return invalid('inconsistent-completion');
    if (receipts.length !== 20 || windows.length !== 20)
      return incomplete('missing-source-or-history');
    if (
      rejected ||
      receipts.some((event) => event.decision !== 'accepted') ||
      windows.some((event) => event.decision !== 'allowed')
    )
      return invalid('rejected-completion');
    actual = 'complete';
  } else if (result.stop === 'clock') {
    if (
      !rejected ||
      (rejected.kind !== 'clock' && rejected.kind !== 'receipt') ||
      rejected.decision === 'accepted'
    )
      return incomplete('missing-clock-decision');
    actual = rejected.decision;
  } else if (terminal.cancelled === 1) {
    if (!events.some((event) => event.kind === 'cancellation'))
      return incomplete('missing-cancellation');
    actual = 'cancelled';
  } else if (result.stop === 'refused') {
    if (!windows.some((event) => event.decision === 'refused'))
      return incomplete('missing-history-decision');
    actual = 'refused';
  } else if (result.stop === 'stall') {
    if (
      events.filter(
        (event) => event.kind === 'cadence' && event.decision === 'late',
      ).length < 2
    )
      return incomplete('missing-stall-decision');
    actual = 'stall';
  } else return incomplete('missing-decision');
  return actual === expected
    ? { state: 'confirmed', decision: actual }
    : invalid('reason-mismatch');
}

/** One strict 200ms proof's test-owned, bounded collector and final classifier. */
export function createNativePublicationEvidence(
  consume?: (event: Observation) => unknown,
) {
  const events: Observation[] = [];
  const observer = createPublicationObserver((event) => {
    events.push(event);
    return consume?.(event);
  });
  const snapshot = (): Snapshot =>
    Object.freeze({
      delivery: observer.status(),
      events: Object.freeze([...events]),
    });
  return {
    observer,
    snapshot,
    assess: (result: Result, expected: Expected) =>
      assessNativePublicationEvidence(snapshot(), result, expected),
  };
}

/** Failure output contains bounded scalar evidence, never native PCM or identity. */
export function assertNativePublicationEvidence(
  proof: ReturnType<typeof createNativePublicationEvidence>,
  result: Result,
  expected: Expected,
) {
  const assessment = proof.assess(result, expected);
  assert({
    given: `actual native publication decisions for ${expected}`,
    should: 'retain complete bounded evidence of the expected actual decision',
    actual: {
      assessment,
      evidence: assessment.state === 'confirmed' ? null : proof.snapshot(),
    },
    expected: {
      assessment: { state: 'confirmed', decision: expected },
      evidence: null,
    },
  });
}
