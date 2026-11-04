import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  audienceStatePath,
  pulseRateFor,
  tabPulses,
  viewersFromSample,
  VIEWER_PULSES_PER_SECOND,
  VIEWER_PULSE_MS,
} from './audience-state';

setupRitewayBun();

test('the audience pulses near the limit however many there are', () => {
  assert({
    given: 'an audience small enough to fit the limit',
    should: 'have every tab pulse',
    actual: [pulseRateFor(0), pulseRateFor(500)],
    expected: [1, 1],
  });
  const viewers = 100_000;
  assert({
    given: 'a large audience',
    should: 'keep the whole audience at the limit',
    actual: (viewers / (VIEWER_PULSE_MS / 1000)) * pulseRateFor(viewers),
    expected: VIEWER_PULSES_PER_SECOND,
  });
});

test('a sampled count says only what it can', () => {
  assert({
    given: 'a small unsampled count',
    should: 'stay exact',
    actual: viewersFromSample(42, 1),
    expected: 42,
  });
  assert({
    given: 'a sampled count',
    should: 'scale up and round to two figures',
    actual: viewersFromSample(487, 0.05),
    expected: 9700,
  });
});

test('the path carries only the key', () => {
  assert({
    given: 'a state key',
    should: 'name its object',
    actual: audienceStatePath('abc'),
    expected: 'state/abc.json',
  });
});

test('a tab keeps its draw as the rate moves', () => {
  assert({
    given: 'one draw under falling rates',
    should: 'pulse until the rate falls past it, and not before',
    actual: [tabPulses(0.2, 1), tabPulses(0.2, 0.5), tabPulses(0.2, 0.1)],
    expected: [true, true, false],
  });
  assert({
    given: 'the highest draw at the full rate',
    should: 'pulse: below the limit every tab counts',
    actual: tabPulses(0.999_999, 1),
    expected: true,
  });
});
