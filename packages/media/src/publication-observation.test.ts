import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPublicationObserver } from './publication-observation';

setupRitewayBun();
const terminal = () => ({
  kind: 'terminal' as const,
  eligibleSamples: 9600,
  complete: 1,
  segmentEnded: 0,
  cancelled: 0,
  stop: null,
});

test('an observation is a frozen unaliased scalar snapshot', () => {
  const received: unknown[] = [];
  const observer = createPublicationObserver((event) => {
    received.push(event);
  });
  const event = terminal();
  observer.observe(event);
  event.eligibleSamples = 0;
  assert({
    given: 'a terminal observation followed by mutation of its original object',
    should:
      'retain an immutable independent record without changing its precision or decision',
    actual: {
      received,
      frozen: Object.isFrozen(received[0]),
      status: observer.status().state,
    },
    expected: {
      received: [{ ...terminal(), sequence: 0 }],
      frozen: true,
      status: 'valid',
    },
  });
});

test('delivery failure after a terminal record remains sticky', () => {
  const received: unknown[] = [];
  const observer = createPublicationObserver((event) => {
    received.push(event);
    throw new Error('synthetic collector failure');
  });
  observer.observe(terminal());
  observer.observe(terminal());
  assert({
    given: 'a collector that stores a terminal record and then throws',
    should:
      'invalidate the whole delivery and stop sending records without propagating its error',
    actual: { records: received.length, status: observer.status() },
    expected: {
      records: 1,
      status: { state: 'invalid', reason: 'consumer-threw', delivered: 0 },
    },
  });
});

test('async callbacks and malformed thenables cannot masquerade as synchronous evidence', async () => {
  const consumers = [
    () => Promise.resolve(),
    () => Promise.reject(new Error('synthetic asynchronous collector failure')),
    () => ({
      then() {
        throw new Error('synthetic then method failure');
      },
    }),
    () => ({
      get then() {
        throw new Error('synthetic then getter failure');
      },
    }),
    () =>
      Object.defineProperty(
        Promise.reject(new Error('synthetic rejected collector promise')),
        'then',
        {
          get() {
            throw new Error('synthetic promise then getter failure');
          },
        },
      ),
  ];
  const states = consumers.map((consume) => {
    const observer = createPublicationObserver(consume);
    observer.observe(terminal());
    return observer.status();
  });
  // The observer does not await these promises; let any rejection become
  // observable to Bun's unhandled-rejection check before the test finishes.
  await Promise.resolve();
  await Promise.resolve();
  assert({
    given: 'fulfilled, rejected, and malformed thenable collector results',
    should:
      'invalidate delivery immediately and absorb rejection without an awaited observer',
    actual: states,
    expected: [
      { state: 'invalid', reason: 'async-consumer', delivered: 0 },
      { state: 'invalid', reason: 'async-consumer', delivered: 0 },
      { state: 'invalid', reason: 'async-consumer', delivered: 0 },
      { state: 'invalid', reason: 'consumer-threw', delivered: 0 },
      { state: 'invalid', reason: 'consumer-threw', delivered: 0 },
    ],
  });
});

test('a mutating collector cannot rewrite a delivered terminal into another decision', () => {
  const observer = createPublicationObserver((event) => {
    (event as { eligibleSamples: number }).eligibleSamples = 1;
  });
  observer.observe(terminal());
  assert({
    given: 'a collector attempting to mutate a frozen snapshot',
    should: 'make its evidence unusable without throwing into the publication',
    actual: observer.status(),
    expected: { state: 'invalid', reason: 'consumer-threw', delivered: 0 },
  });
});

test('record limits never silently turn truncated evidence into complete delivery', () => {
  let records = 0;
  const observer = createPublicationObserver(() => {
    records++;
  });
  for (let index = 0; index < 65; index++) observer.observe(terminal());
  assert({
    given: 'more than the fixed non-frame evidence budget',
    should:
      'stop copying at its cap and retain an explicit invalid-delivery marker',
    actual: { records, status: observer.status() },
    expected: {
      records: 64,
      status: { state: 'invalid', reason: 'truncated', delivered: 64 },
    },
  });
});

test('nonfinite numeric evidence is explicit instead of JSON null', () => {
  const received: unknown[] = [];
  const observer = createPublicationObserver((event) => {
    received.push(event);
  });
  observer.observe({
    kind: 'cadence',
    dueMs: Number.NaN,
    observedAtMs: Infinity,
    clockSamples: -Infinity,
    decision: 'late',
  });
  assert({
    given: 'nonfinite injected evidence',
    should: 'retain explicit numeric tags in a serializable snapshot',
    actual: JSON.parse(JSON.stringify(received)),
    expected: [
      {
        kind: 'cadence',
        dueMs: 'NaN',
        observedAtMs: 'Infinity',
        clockSamples: '-Infinity',
        decision: 'late',
        sequence: 0,
      },
    ],
  });
});
