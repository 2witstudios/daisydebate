import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationClock } from './observation-clock';
setupRitewayBun();
test('supported elapsed time remains monotonic but suspend disagreement fails closed irreversibly', () => {
  let monotonic = 0,
    wall = 1000,
    uncertainties = 0;
  const clock = createObservationClock({
    monotonicNow: () => monotonic,
    wallNow: () => wall,
    onUncertainty: () => {
      uncertainties++;
    },
  });
  monotonic = 10000;
  wall = 11000;
  const elapsed = clock.now();
  monotonic = 11000;
  wall = 19000;
  const uncertain = Number.isNaN(clock.now());
  wall = 12000;
  const restored = Number.isNaN(clock.now());
  assert({
    given:
      'a long event-loop pause advances both clocks, then wall elapsed exceeds monotonic elapsed beyond the 100ms envelope',
    should:
      'support elapsed expiry but fence once and never restore trust merely because clocks realign',
    actual: { elapsed, uncertain, restored, uncertainties },
    expected: {
      elapsed: 10000,
      uncertain: true,
      restored: true,
      uncertainties: 1,
    },
  });
});
for (const direction of ['monotonic', 'wall', 'nonfinite'] as const)
  test(`${direction} clock uncertainty fences observation`, () => {
    let monotonic = 10,
      wall = 1000,
      calls = 0;
    const clock = createObservationClock({
      monotonicNow: () => monotonic,
      wallNow: () => wall,
      onUncertainty: () => {
        calls++;
      },
    });
    if (direction === 'monotonic') monotonic = 9;
    else if (direction === 'wall') wall = 999;
    else monotonic = NaN;
    assert({
      given: `${direction} clock discontinuity`,
      should: 'refuse observation time immediately',
      actual: { unavailable: Number.isNaN(clock.now()), calls },
      expected: { unavailable: true, calls: 1 },
    });
  });
