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

type Event<K extends Observation['kind']> = Extract<Observation, { kind: K }>;
type Ledger = {
  stage: 'initial' | 'ready' | 'receipt' | 'history' | 'reanchor' | 'stopped';
  sourceSamples: number;
  creditedSamples: number;
  late: boolean;
  clock: Event<'clock'> | null;
  cadence: Event<'cadence'> | null;
  receipt: Event<'receipt'> | null;
  decision: Expected | null;
  terminal: Event<'terminal'> | null;
};
const invalid = (reason: string): Assessment => ({ state: 'invalid', reason });
const incomplete = (reason: string): Assessment => ({
  state: 'incomplete',
  reason,
});

/** Reuse the delivery boundary's closed schema, including explicit numeric tags. */
function validEnvelope(snapshot: Snapshot): Assessment | null {
  if (!snapshot || !Array.isArray(snapshot.events) || !snapshot.delivery)
    return invalid('malformed');
  const { events, delivery } = snapshot;
  if (delivery.state === 'invalid')
    return invalid(`delivery.${delivery.reason}`);
  if (delivery.state !== 'valid') return invalid('malformed-delivery');
  if (!events.length) return incomplete('not-observed');
  if (delivery.delivered !== events.length) return incomplete('missing-record');
  return recordShapes(events);
}
function recordShapes(events: readonly Observation[]): Assessment | null {
  const shape = createPublicationObserver(() => {});
  try {
    for (const [sequence, event] of events.entries()) {
      if (!event || event.sequence !== sequence) return invalid('record-order');
      const decoded = Object.fromEntries(
        Object.entries(event)
          .filter(([key]) => key !== 'sequence')
          .map(([key, value]) => [key, decodeNumber(value)]),
      );
      shape.observe(decoded as never);
    }
    return shape.status().state === 'valid'
      ? null
      : invalid('record-shape-or-cap');
  } catch {
    return invalid('record-shape');
  }
}
function decodeNumber(value: unknown) {
  switch (value) {
    case 'undefined':
      return undefined;
    case 'NaN':
      return Number.NaN;
    case 'Infinity':
      return Infinity;
    case '-Infinity':
      return -Infinity;
    default:
      return value;
  }
}
function stop(ledger: Ledger, decision: Expected) {
  ledger.decision = decision;
  ledger.stage = 'stopped';
}
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function acceptedClockShape(event: Event<'clock'>) {
  const precision =
    event.precisionPresent === 0
      ? event.precisionMs === 'undefined'
      : finiteNumber(event.precisionMs);
  return (
    precision &&
    event.sampleRate === 48000 &&
    [
      event.anchorMs,
      event.sentAtMs,
      event.receivedAtMs,
      event.serverNowMs,
    ].every(finiteNumber)
  );
}
function clockEntry(ledger: Ledger, event: Event<'clock'>) {
  const phases = {
    initial: 'initial',
    ready: 'refresh',
    reanchor: 'reanchor',
    receipt: null,
    history: null,
    stopped: null,
  };
  if (event.phase !== phases[ledger.stage]) return 'clock-phase';
  if (event.clockSamples !== ledger.sourceSamples) return 'clock-prefix';
  if (event.decision !== 'accepted') {
    stop(ledger, event.decision);
    return null;
  }
  if (!acceptedClockShape(event)) return 'accepted-clock-shape';
  if (event.phase === 'refresh' && event.anchorMs !== ledger.clock?.anchorMs)
    return 'refresh-anchor';
  ledger.clock = event;
  ledger.stage = 'ready';
  return null;
}
function cadenceEntry(ledger: Ledger, event: Event<'cadence'>) {
  if (ledger.stage !== 'ready' || event.clockSamples !== ledger.sourceSamples)
    return 'cadence-order-or-prefix';
  if (
    ![event.dueMs, event.observedAtMs].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  )
    return 'cadence-shape';
  ledger.cadence = event;
  if (event.decision === 'ready') ledger.stage = 'receipt';
  else if (ledger.late) stop(ledger, 'stall');
  else {
    ledger.late = true;
    ledger.stage = 'reanchor';
  }
  return null;
}
function receiptEntry(ledger: Ledger, event: Event<'receipt'>) {
  const expectedClock = {
    clockSamples: ledger.sourceSamples,
    dueMs: ledger.cadence?.dueMs,
    anchorMs: ledger.clock?.anchorMs,
    sampleRate: ledger.clock?.sampleRate,
    calibrationReceivedAtMs: ledger.clock?.receivedAtMs,
  };
  const sameClock = Object.entries(expectedClock).every(
    ([key, value]) => event[key as keyof typeof expectedClock] === value,
  );
  if (ledger.stage !== 'receipt' || !sameClock) return 'receipt-order-or-clock';
  if (event.decision !== 'accepted') {
    if (
      event.windowBeforeMs !== 'undefined' ||
      event.windowAfterMs !== 'undefined'
    )
      return 'rejected-window';
    stop(ledger, event.decision);
    return null;
  }
  if (!contiguousSourceFrame(ledger.sourceSamples, event))
    return 'source-prefix-or-window';
  ledger.sourceSamples = event.endSample as number;
  ledger.receipt = event;
  ledger.late = false;
  ledger.stage = 'history';
  return null;
}
function contiguousSourceFrame(prefix: number, event: Event<'receipt'>) {
  return (
    event.startSample === prefix &&
    event.endSample === prefix + 480 &&
    [
      event.beforeMs,
      event.afterMs,
      event.windowBeforeMs,
      event.windowAfterMs,
    ].every(finiteNumber)
  );
}
function historyEntry(ledger: Ledger, event: Event<'authorization'>) {
  if (
    ledger.stage !== 'history' ||
    event.sourceSamples !== ledger.sourceSamples ||
    event.beforeMs !== ledger.receipt?.windowBeforeMs ||
    event.afterMs !== ledger.receipt?.windowAfterMs
  )
    return 'history-source-pair';
  if (event.decision !== 'allowed')
    stop(ledger, event.decision === 'ended' ? 'refused' : event.decision);
  else {
    if (event.cancelled !== 0) return 'cancelled-credit';
    ledger.creditedSamples = ledger.sourceSamples;
    ledger.stage = 'ready';
  }
  return null;
}
function cancellationEntry(ledger: Ledger, event: Event<'cancellation'>) {
  const allowed = {
    'before-frame': ['ready', 'initial'],
    'after-wait': ['ready'],
    'after-handoff': ['history', 'stopped'],
    'after-history': ['stopped'],
  };
  if (
    !allowed[event.phase].includes(ledger.stage) ||
    event.clockSamples !== ledger.sourceSamples
  )
    return 'cancellation-order-or-prefix';
  stop(ledger, 'cancelled');
  return null;
}

/** Ordered 20-frame proof ledger, not a replay of timing predicates. */
function publicationLedger(events: readonly Observation[]) {
  const ledger: Ledger = {
    stage: 'initial',
    sourceSamples: 0,
    creditedSamples: 0,
    late: false,
    clock: null,
    cadence: null,
    receipt: null,
    decision: null,
    terminal: null,
  };
  for (const event of events) {
    if (ledger.terminal) return { error: 'after-terminal', ledger };
    let error: string | null;
    switch (event.kind) {
      case 'clock':
        error = clockEntry(ledger, event);
        break;
      case 'cadence':
        error = cadenceEntry(ledger, event);
        break;
      case 'receipt':
        error = receiptEntry(ledger, event);
        break;
      case 'authorization':
        error = historyEntry(ledger, event);
        break;
      case 'cancellation':
        error = cancellationEntry(ledger, event);
        break;
      case 'terminal':
        ledger.terminal = event;
        error = null;
        break;
    }
    if (error) return { error, ledger };
  }
  return { error: null, ledger };
}
function completeEvidence(ledger: Ledger, result: Result): Assessment {
  if (ledger.stage !== 'ready' || ledger.sourceSamples !== 9600)
    return incomplete('missing-source-or-history');
  if (result.eligibleSamples !== ledger.creditedSamples)
    return invalid('terminal-credit-prefix');
  if (
    result.stop !== null ||
    result.segmentEnded ||
    ledger.terminal?.cancelled !== 0 ||
    ledger.decision
  )
    return invalid('inconsistent-completion');
  return { state: 'confirmed', decision: 'complete' };
}
function stoppedEvidence(ledger: Ledger, result: Result): Assessment {
  if (!ledger.decision) return incomplete('missing-decision');
  const expectedStop =
    ledger.decision === 'cancelled'
      ? null
      : ledger.decision.includes('.')
        ? 'clock'
        : ledger.decision;
  if (
    result.stop !== expectedStop ||
    ledger.terminal?.cancelled !== Number(ledger.decision === 'cancelled')
  )
    return invalid('inconsistent-stop');
  return { state: 'confirmed', decision: ledger.decision };
}
function reconcile(ledger: Ledger, result: Result): Assessment {
  const terminal = ledger.terminal;
  if (!terminal) return incomplete('missing-terminal');
  const reported = {
    eligibleSamples: result.eligibleSamples,
    complete: Number(result.complete),
    segmentEnded: Number(result.segmentEnded),
    stop: result.stop,
  };
  if (
    !Object.entries(reported).every(
      ([key, value]) => terminal[key as keyof typeof reported] === value,
    )
  )
    return invalid('terminal-result-or-prefix');
  if (result.complete) return completeEvidence(ledger, result);
  if (result.eligibleSamples !== ledger.creditedSamples)
    return invalid('terminal-credit-prefix');
  return stoppedEvidence(ledger, result);
}

export function assessNativePublicationEvidence(
  snapshot: Snapshot,
  result: Result,
  expected: Expected,
): Assessment {
  const envelope = validEnvelope(snapshot);
  if (envelope) return envelope;
  const { error, ledger } = publicationLedger(snapshot.events);
  if (error) return invalid(error);
  const assessment = reconcile(ledger, result);
  return assessment.state === 'confirmed' && assessment.decision !== expected
    ? invalid('reason-mismatch')
    : assessment;
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
