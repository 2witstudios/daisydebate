import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observeDispatches,
  dispatchFacts,
} from '../integration/economics-ac3-observation.test-support';
setupRitewayBun();

test('sequential observed work grows volume without increasing concurrent high-water', async () => {
  let now = 0;
  const observer = observeDispatches(() => now++);
  await observer.call('casual_ai_judge', async () => 1);
  const first = observer.facts('casual_ai_judge');
  await observer.call('casual_ai_judge', async () => 2);
  assert({
    given: 'two actual sequential controlled work promises',
    should:
      'derive cumulative calls separately from observed overlap, with no active work',
    actual: [first, observer.facts('casual_ai_judge')],
    expected: [
      { calls: 1, known: 1, unknown: 0, peak: 1, active: 0 },
      { calls: 2, known: 2, unknown: 0, peak: 1, active: 0 },
    ],
  });
});

test('overlap and unknown settlement are observed rather than assigned a peak of one', async () => {
  let now = 0;
  const observer = observeDispatches(() => now++),
    gate = Promise.withResolvers<void>();
  const first = observer.call('round_analysis', () => gate.promise);
  const second = observer
    .call('round_analysis', async () => {
      throw Error('Controlled unknown');
    })
    .catch(() => undefined);
  await second;
  gate.resolve();
  await first;
  assert({
    given:
      'two overlapping work intervals, including one failed provider boundary',
    should:
      'derive a peak of two, preserve possible exposure and drain both intervals',
    actual: observer.facts('round_analysis'),
    expected: { calls: 2, known: 1, unknown: 1, peak: 2, active: 0 },
  });
});

test('a replayed settlement cannot reduce a different live dispatch', () => {
  let rejected = false;
  try {
    dispatchFacts(
      [
        {
          feature: 'round_analysis',
          token: 1,
          sequence: 0,
          monotonicMs: 0,
          kind: 'known-settle',
        },
      ],
      'round_analysis',
    );
  } catch {
    rejected = true;
  }
  assert({
    given: 'a settlement without its original observed dispatch',
    should: 'refuse invented completed work',
    actual: rejected,
    expected: true,
  });
});
