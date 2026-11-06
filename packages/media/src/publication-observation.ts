import type { PublicationStop } from './audio-publication';
import type { publicationClock } from './publication-clock';

type Rejection = Extract<
  ReturnType<typeof publicationClock>,
  { valid: false }
>['rejection'];
type Decision = Rejection | 'accepted';
type Observation =
  | {
      readonly kind: 'clock';
      readonly phase: 'initial' | 'refresh' | 'reanchor';
      readonly decision: Decision;
      readonly anchorMs: number;
      readonly clockSamples: number;
      readonly sampleRate: number;
      readonly sentAtMs: number;
      readonly receivedAtMs: number;
      readonly serverNowMs: number;
      readonly precisionMs: number | undefined;
      readonly precisionPresent: number;
    }
  | {
      readonly kind: 'receipt';
      readonly decision: Decision;
      readonly clockSamples: number;
      readonly anchorMs: number;
      readonly sampleRate: number;
      readonly startSample: number;
      readonly endSample: number;
      readonly beforeMs: number;
      readonly afterMs: number;
      readonly dueMs: number;
      readonly calibrationReceivedAtMs: number;
    }
  | {
      readonly kind: 'cadence';
      readonly decision: 'ready' | 'late';
      readonly dueMs: number;
      readonly observedAtMs: number;
      readonly clockSamples: number;
    }
  | {
      readonly kind: 'authorization';
      readonly decision: 'allowed' | 'refused' | 'ended';
      readonly beforeMs: number;
      readonly afterMs: number;
      readonly sourceSamples: number;
      readonly cancelled: number;
    }
  | {
      readonly kind: 'cancellation';
      readonly phase:
        'before-frame' | 'after-wait' | 'after-handoff' | 'after-history';
      readonly clockSamples: number;
    }
  | {
      readonly kind: 'terminal';
      readonly eligibleSamples: number;
      readonly complete: number;
      readonly segmentEnded: number;
      readonly cancelled: number;
      readonly stop: PublicationStop | null;
    };

type Scalar<T> = T extends number
  ? number | 'NaN' | 'Infinity' | '-Infinity'
  : T extends undefined
    ? 'undefined'
    : T;
type Copied<T> = T extends Observation
  ? { readonly [K in keyof T]: Scalar<T[K]> } & { readonly sequence: number }
  : never;
type Invalidity =
  | 'malformed-event'
  | 'truncated'
  | 'consumer-threw'
  | 'async-consumer'
  | 'consumer-returned';
type Delivery =
  | { readonly state: 'valid'; readonly delivered: number }
  | {
      readonly state: 'invalid';
      readonly reason: Invalidity;
      readonly delivered: number;
    };

// Vocabulary only: the ordered predicates remain exclusively in publication-clock.
const rejections = {
  'calibration.nonfinite': true,
  'calibration.sample-rate': true,
  'calibration.rtt-order': true,
  'calibration.rtt-limit': true,
  'calibration.precision-order': true,
  'calibration.precision-limit': true,
  'calibration.anchor-order': true,
  'receipt.nonfinite': true,
  'receipt.noncontiguous': true,
  'receipt.frame-size': true,
  'receipt.early': true,
  'receipt.reversed': true,
  'receipt.late': true,
  'receipt.before-calibration': true,
  'receipt.stale': true,
  'refresh.age-order': true,
  'refresh.request-order': true,
  'refresh.stale': true,
  'refresh.offset-ahead': true,
  'refresh.offset-behind': true,
} satisfies Record<Rejection, true>;
const stops = {
  connect: true,
  unheard: true,
  handoff: true,
  stall: true,
  clock: true,
  refused: true,
} satisfies Record<PublicationStop, true>;
const fields = {
  clock: [
    'phase',
    'decision',
    'anchorMs',
    'clockSamples',
    'sampleRate',
    'sentAtMs',
    'receivedAtMs',
    'serverNowMs',
    'precisionMs',
    'precisionPresent',
  ],
  receipt: [
    'decision',
    'clockSamples',
    'anchorMs',
    'sampleRate',
    'startSample',
    'endSample',
    'beforeMs',
    'afterMs',
    'dueMs',
    'calibrationReceivedAtMs',
  ],
  cadence: ['decision', 'dueMs', 'observedAtMs', 'clockSamples'],
  authorization: [
    'decision',
    'beforeMs',
    'afterMs',
    'sourceSamples',
    'cancelled',
  ],
  cancellation: ['phase', 'clockSamples'],
  terminal: [
    'eligibleSamples',
    'complete',
    'segmentEnded',
    'cancelled',
    'stop',
  ],
} satisfies Record<Observation['kind'], readonly string[]>;

function validScalar(kind: Observation['kind'], key: string, value: unknown) {
  if (key === 'phase')
    return (
      kind === 'clock'
        ? ['initial', 'refresh', 'reanchor']
        : ['before-frame', 'after-wait', 'after-handoff', 'after-history']
    ).includes(value as string);
  if (key === 'decision') {
    if (kind === 'clock' || kind === 'receipt')
      return (
        value === 'accepted' ||
        (typeof value === 'string' && Object.hasOwn(rejections, value))
      );
    return (
      kind === 'cadence' ? ['ready', 'late'] : ['allowed', 'refused', 'ended']
    ).includes(value as string);
  }
  if (key === 'stop')
    return (
      value === null ||
      (typeof value === 'string' && Object.hasOwn(stops, value))
    );
  if (
    ['complete', 'segmentEnded', 'cancelled', 'precisionPresent'].includes(key)
  )
    return value === 0 || value === 1;
  return (
    typeof value === 'number' || (key === 'precisionMs' && value === undefined)
  );
}

function copied(
  event: Observation,
  sequence: number,
): Copied<Observation> | null {
  if (!event || typeof event !== 'object' || !Object.hasOwn(fields, event.kind))
    return null;
  const keys: readonly string[] = fields[event.kind];
  if (Object.keys(event).length !== keys.length + 1) return null;
  const copy: Record<string, unknown> = { kind: event.kind, sequence };
  for (const key of keys) {
    if (!Object.hasOwn(event, key)) return null;
    const value: unknown = (event as unknown as Record<string, unknown>)[key];
    if (!validScalar(event.kind, key, value)) return null;
    copy[key] =
      value === undefined
        ? 'undefined'
        : typeof value === 'number' && !Number.isFinite(value)
          ? Number.isNaN(value)
            ? 'NaN'
            : value > 0
              ? 'Infinity'
              : '-Infinity'
          : value;
  }
  return Object.freeze(copy) as Copied<Observation>;
}

/** Bypass a returned Promise's own poisoned `then`; never await a consumer. */
function absorbRejection(value: unknown) {
  try {
    void Promise.prototype.then.call(value, undefined, () => undefined);
  } catch {
    // Promise.resolve also converts a throwing thenable getter/method into a
    // rejected promise; attach its handler using the intrinsic method too.
    try {
      const promise = Promise.resolve(value);
      void Promise.prototype.then.call(promise, undefined, () => undefined);
    } catch {
      // No consumer error becomes a publication decision or a log payload.
    }
  }
}

/**
 * Synchronous, bounded evidence delivery, independent of publication authority.
 * No callback is awaited. A failed consumer remains unusable even if it stored
 * a terminal record first; callers must read final status when assessing evidence.
 */
export function createPublicationObserver(
  consume: (event: Copied<Observation>) => unknown,
) {
  let delivery: Delivery = { state: 'valid', delivered: 0 };
  let receipts = 0;
  let other = 0;
  const invalidate = (reason: Invalidity) => {
    if (delivery.state === 'valid')
      delivery = { state: 'invalid', reason, delivered: delivery.delivered };
  };
  return Object.freeze({
    observe(event: Observation): undefined {
      if (delivery.state === 'invalid') return;
      try {
        const snapshot = copied(event, delivery.delivered);
        if (!snapshot) {
          invalidate('malformed-event');
          return;
        }
        if (event.kind === 'receipt' ? receipts >= 20 : other >= 64) {
          invalidate('truncated');
          return;
        }
        if (event.kind === 'receipt') receipts++;
        else other++;
        const returned = consume(snapshot);
        if (returned !== undefined) {
          absorbRejection(returned);
          const then =
            returned !== null &&
            ['object', 'function'].includes(typeof returned)
              ? (returned as { then?: unknown }).then
              : undefined;
          if (typeof then === 'function') {
            invalidate('async-consumer');
          } else invalidate('consumer-returned');
          return;
        }
        delivery = { state: 'valid', delivered: delivery.delivered + 1 };
      } catch {
        invalidate('consumer-threw');
      }
    },
    status: (): Delivery => Object.freeze({ ...delivery }),
  });
}
