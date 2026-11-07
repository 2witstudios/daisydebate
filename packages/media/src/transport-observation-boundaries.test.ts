import { assert, setupRitewayBun, test } from 'riteway/bun';
import { TransportObservation } from './transport-observation/transport-observation';
import { TransportFixture } from './transport-observation.test-support';
setupRitewayBun();
const { row, setup } = TransportFixture;
test('a missing report cannot authorize a replacement identity', async () => {
  const s = setup([[row()], [], [row(11n, 'replacement')]]);
  await s.observer.read();
  s.at(1500);
  await s.observer.read();
  s.at(2000);
  assert({
    given:
      'an original native identity followed by missing metadata then another identity',
    should:
      'retain the original binding across uncertainty and require explicit rebind',
    actual: await s.observer.read(),
    expected: { kind: 'unknown', reason: 'replaced' },
  });
});
test('cancellation during clock observation refuses native dispatch', async () => {
  const abort = new AbortController();
  let calls = 0;
  const o = TransportObservation.create({
    binding: {
      incarnation: 'c'.repeat(24),
      trackId: 'TR_original',
      generation: 1,
    },
    nowMs: () => {
      abort.abort();
      return 1000;
    },
    readStats: async () => {
      calls++;
      return [row()];
    },
  });
  assert({
    given: 'a cancellation observed after the first admission check',
    should: 'refuse before issuing the native read',
    actual: { result: await o.read(abort.signal), calls },
    expected: { result: { kind: 'unknown', reason: 'cancelled' }, calls: 0 },
  });
});
test('a response delivered after its bound is unknown and supplied native errors are sanitized', async () => {
  let now = 1000;
  const o = TransportObservation.create({
    binding: {
      incarnation: 'c'.repeat(24),
      trackId: 'TR_original',
      generation: 1,
    },
    nowMs: () => now,
    readStats: async () => {
      now += 1000;
      return [row()];
    },
  });
  const failure = TransportObservation.create({
    binding: {
      incarnation: 'c'.repeat(24),
      trackId: 'TR_original',
      generation: 1,
    },
    nowMs: () => 1000,
    readStats: async () => {
      throw new Error('synthetic-private-vendor-content');
    },
  });
  assert({
    given: 'a delayed response or native rejection carrying private text',
    should: 'return fixed unknown reasons only',
    actual: [await o.read(), await failure.read()],
    expected: [
      { kind: 'unknown', reason: 'deadline' },
      { kind: 'unknown', reason: 'unavailable' },
    ],
  });
});

test('close during final clock sampling cannot reopen an observation', async () => {
  let reads = 0;
  let close: () => void = () => undefined;
  const o = TransportObservation.create({
    binding: {
      incarnation: 'c'.repeat(24),
      trackId: 'TR_original',
      generation: 1,
    },
    nowMs: () => {
      if (++reads === 2) close();
      return 1000 + reads;
    },
    readStats: async () => [row()],
  });
  close = () => o.close();
  assert({
    given: 'a close linearizing during final observation validation',
    should: 'discard the response and keep the binding closed',
    actual: { response: await o.read(), again: await o.read() },
    expected: {
      response: { kind: 'unknown', reason: 'closed' },
      again: { kind: 'unknown', reason: 'closed' },
    },
  });
});
