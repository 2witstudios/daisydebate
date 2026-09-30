import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  PROVIDER_LATENCY_PRIOR_MS,
  createProviderLatency,
  systemSendPacing,
} from './send-pacing';

setupRitewayBun();

describe('createProviderLatency', () => {
  test('answers the prior until a round trip is measured', () => {
    assert({
      given: 'no measured round trip',
      should: 'sample the prior',
      actual: createProviderLatency(() => 0).sample(),
      expected: PROVIDER_LATENCY_PRIOR_MS,
    });
  });

  test('samples a measured round trip at the index the picker chooses', () => {
    const picks: number[] = [];
    const latency = createProviderLatency((size) => {
      picks.push(size);
      return 2;
    });
    for (const ms of [120, 340, 560]) latency.observe(ms);
    assert({
      given: 'three measured round trips and a picker choosing index 2',
      should: 'ask for an index below 3 and answer the third',
      actual: { sample: latency.sample(), picks },
      expected: { sample: 560, picks: [3] },
    });
  });

  test('keeps only the most recent 64 round trips', () => {
    const sizes: number[] = [];
    const latency = createProviderLatency((size) => {
      sizes.push(size);
      return 0;
    });
    for (let ms = 1; ms <= 70; ms += 1) latency.observe(ms);
    assert({
      given: '70 measured round trips',
      should:
        'draw from 64, the oldest six overwritten (slot 0 now holds the 65th)',
      actual: { sample: latency.sample(), size: sizes[0] },
      expected: { sample: 65, size: 64 },
    });
  });
});

describe('createProviderLatency lateness', () => {
  test('averages the most recent 16 wake-up delays, none before any', () => {
    const latency = createProviderLatency(() => 0);
    const before = latency.lateness();
    for (const ms of [2, 4, -1]) latency.observeLateness(ms);
    const few = latency.lateness();
    for (let index = 0; index < 16; index += 1) latency.observeLateness(8);
    assert({
      given: 'no wake-up yet, then 2, 4 and an early (-1) one, then 16 of 8',
      should: 'answer 0, then their mean with the early one as 0, then 8',
      actual: [before, few, latency.lateness()],
      expected: [0, 2, 8],
    });
  });
});

describe('systemSendPacing.pick', () => {
  test('answers an index in range for every size', () => {
    const indexes = [1, 2, 3, 64].flatMap((size) =>
      Array.from({ length: 200 }, () => systemSendPacing.pick(size) < size),
    );
    assert({
      given: '200 picks each for sizes 1, 2, 3 and 64',
      should: 'answer only indexes below the size',
      actual: indexes.every(Boolean),
      expected: true,
    });
  });
});
