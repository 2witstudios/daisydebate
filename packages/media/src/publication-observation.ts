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
      readonly windowBeforeMs: number | undefined;
      readonly windowAfterMs: number | undefined;
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
  | 'reentrant-consumer'
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
    'windowBeforeMs',
    'windowAfterMs',
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

const enumFields: Partial<
  Record<Observation['kind'], Record<string, readonly unknown[]>>
> = {
  clock: {
    phase: ['initial', 'refresh', 'reanchor'],
    decision: ['accepted', ...Object.keys(rejections)],
    precisionPresent: [0, 1],
  },
  receipt: { decision: ['accepted', ...Object.keys(rejections)] },
  cadence: { decision: ['ready', 'late'] },
  authorization: {
    decision: ['allowed', 'refused', 'ended'],
    cancelled: [0, 1],
  },
  cancellation: {
    phase: ['before-frame', 'after-wait', 'after-handoff', 'after-history'],
  },
  terminal: {
    complete: [0, 1],
    segmentEnded: [0, 1],
    cancelled: [0, 1],
    stop: [null, ...Object.keys(stops)],
  },
};
function validScalar(kind: Observation['kind'], key: string, value: unknown) {
  const vocabulary = enumFields[kind]?.[key];
  if (vocabulary) return vocabulary.includes(value);
  return (
    typeof value === 'number' ||
    (['precisionMs', 'windowBeforeMs', 'windowAfterMs'].includes(key) &&
      value === undefined)
  );
}

function scalarSnapshot(value: unknown) {
  if (value === undefined) return 'undefined';
  if (typeof value !== 'number' || Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return 'NaN';
  return value > 0 ? 'Infinity' : '-Infinity';
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
    copy[key] = scalarSnapshot(value);
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

/** Callback-edge errors never escape into publication authority. */
function deliver(
  consume: (event: Copied<Observation>) => unknown,
  event: Copied<Observation>,
): Invalidity | null {
  try {
    const returned = consume(event);
    if (returned === undefined) return null;
    absorbRejection(returned);
    const then =
      returned !== null && ['object', 'function'].includes(typeof returned)
        ? (returned as { then?: unknown }).then
        : undefined;
    return typeof then === 'function' ? 'async-consumer' : 'consumer-returned';
  } catch {
    return 'consumer-threw';
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
  type State = {
    readonly delivered: number;
    readonly receipts: number;
    readonly other: number;
  } & (
    | { readonly state: 'ready' | 'delivering' }
    | { readonly state: 'invalid'; readonly reason: Invalidity }
  );
  let delivery: State = { state: 'ready', delivered: 0, receipts: 0, other: 0 };
  const invalidate = (reason: Invalidity) => {
    if (delivery.state !== 'invalid')
      delivery = { ...delivery, state: 'invalid', reason };
  };
  return Object.freeze({
    observe(event: Observation): undefined {
      if (delivery.state === 'invalid') return;
      if (delivery.state === 'delivering') {
        invalidate('reentrant-consumer');
        return;
      }
      delivery = { ...delivery, state: 'delivering' };
      try {
        const snapshot = copied(event, delivery.delivered);
        if (!snapshot) return void invalidate('malformed-event');
        if (delivery.state !== 'delivering') return;
        const counter = snapshot.kind === 'receipt' ? 'receipts' : 'other';
        if (delivery[counter] >= (counter === 'receipts' ? 20 : 64))
          return void invalidate('truncated');
        delivery = { ...delivery, [counter]: delivery[counter] + 1 };
        const failure = deliver(consume, snapshot);
        if (failure) return void invalidate(failure);
        // A nested delivery can invalidate the handle while consume is running.
        if (delivery.state === 'delivering')
          delivery = {
            ...delivery,
            state: 'ready',
            delivered: delivery.delivered + 1,
          };
      } catch {
        invalidate('consumer-threw');
      }
    },
    status: (): Delivery =>
      Object.freeze(
        delivery.state === 'invalid'
          ? {
              state: 'invalid',
              reason: delivery.reason,
              delivered: delivery.delivered,
            }
          : { state: 'valid', delivered: delivery.delivered },
      ),
  });
}
