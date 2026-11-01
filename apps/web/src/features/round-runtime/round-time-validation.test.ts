import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createRoundTime,
  decideSample,
  type RoundTimeSample,
} from './round-time';
setupRitewayBun();
const sample = (overrides: Partial<RoundTimeSample> = {}): RoundTimeSample => ({
  serverNowMs: 10000,
  sentAtMs: 0,
  receivedAtMs: 0,
  generation: 1,
  ...overrides,
});

test('invalid generation and negative monotonic instants cannot poison ordering', () => {
  assert({
    given: 'negative/fractional/unsafe generations and a negative send instant',
    should: 'refuse every malformed interval before accepting it',
    actual: [
      ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(
        (generation) => decideSample(null, sample({ generation })).accepted,
      ),
      decideSample(null, sample({ sentAtMs: -10, receivedAtMs: 0 })).accepted,
      decideSample(
        null,
        sample({
          serverNowMs: Number.MAX_VALUE,
          sentAtMs: 0,
          receivedAtMs: 2000,
        }),
      ).accepted,
    ],
    expected: [false, false, false, false, false],
  });
});

test('rollback tolerance uses the previous and candidate error bounds', () => {
  const clock = createRoundTime({ monotonicNowMs: () => 1000 });
  clock.sample(sample({ serverNowMs: 10_000, sentAtMs: 0, receivedAtMs: 0 }));
  assert({
    given:
      'an exact accepted clock projects 11000 and a 200ms RTT estimate claims 10850 ±100',
    should:
      'refuse a correction whose uncertainty cannot overlap accepted authority',
    actual: clock.sample(
      sample({
        serverNowMs: 10_750,
        sentAtMs: 800,
        receivedAtMs: 1000,
        generation: 2,
      }),
    ).accepted,
    expected: false,
  });
});
