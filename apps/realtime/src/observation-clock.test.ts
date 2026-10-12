import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationClock } from './observation-clock';
import {
  createObservationPermit,
  observationEvidence,
} from './observation-permit';
setupRitewayBun();
test('the two clock envelope edges cannot extend the proposed five-second enqueue bound', () => {
  let monotonic = 0,
    wall = 0,
    uncertainties = 0;
  const clock = createObservationClock({
    monotonicNow: () => monotonic,
    wallNow: () => wall,
    onUncertainty: () => {
      uncertainties++;
    },
  });
  const permit = createObservationPermit({
    now: clock.now,
    nodeIncarnation: 'node',
  });
  const base = {
    schema: 1,
    resource: { kind: 'round', id: 'a'.repeat(24) },
    partition: { kind: 'shared', policyKey: 'round-clock-v1' },
    disclosureRevision: 1,
    window: { after: null, limit: 1 },
  } as const;
  monotonic = 1000;
  wall = 900;
  const evidence = observationEvidence({
    started: clock.now(),
    remainingMs: 5000,
    fingerprint: 'current',
    dependencies: [],
  });
  const installed = permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: evidence,
    cohort: evidence,
    entitlement: evidence,
  });
  const revocationWall = 901;
  monotonic = 5899;
  wall = 5999;
  const allowed = permit.allows(base, 1, 'node', 0);
  assert({
    given:
      'acquisition at negative100ms skew then final enqueue at positive100ms skew after committed revocation',
    should:
      'admit current authority but refuse the unchanged protected body past five real seconds despite each clock reading remaining in its envelope',
    actual: {
      installed,
      elapsed: wall - revocationWall,
      allowed,
      uncertainties,
    },
    expected: {
      installed: true,
      elapsed: 5098,
      allowed: false,
      uncertainties: 0,
    },
  });
});
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
