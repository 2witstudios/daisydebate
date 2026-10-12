import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createObservationPermit,
  observationEvidence,
} from './observation-permit';
import type { ObservationBase } from '@daisy/protocol';
setupRitewayBun();
const base: ObservationBase = {
  schema: 1,
  resource: { kind: 'channel', id: 'a'.repeat(24) },
  partition: { kind: 'shared', policyKey: 'channel-v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('each evidence component retains its own age through renewals', () => {
  let now = 0;
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const evidence = (started: number) =>
    observationEvidence({
      started,
      remainingMs: 10000,
      fingerprint: 'same',
      dependencies: [],
    });
  const cohort = evidence(0);
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    subject: evidence(0),
    cohort,
    entitlement: evidence(0),
  });
  now = 3000;
  const attempt = permit.begin();
  const duringRenewal = permit.allows(base, 1, 'node');
  permit.install(attempt, {
    base,
    minimumContentRevision: 1,
    subject: evidence(3000),
    cohort,
    entitlement: evidence(3000),
  });
  now = 4900;
  assert({
    given: 'unchanged cohort reused while subject renews',
    should:
      'keep active permission during pending renewal but expire the cohort independently',
    actual: [duringRenewal, permit.allows(base, 1, 'node')],
    expected: [true, false],
  });
});
test('denial, clock uncertainty and stale acquisition cannot restore bytes', () => {
  let now = 0;
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const part = observationEvidence({
    started: 0,
    remainingMs: 10000,
    fingerprint: 'same',
    dependencies: [{ key: 'peer', revision: '2' }],
  });
  const grant = {
    base,
    minimumContentRevision: 2,
    subject: part,
    cohort: part,
    entitlement: part,
  };
  const attempt = permit.begin();
  permit.invalidate('peer');
  const stale = permit.install(attempt, grant);
  permit.install(permit.begin(), grant);
  const floor = permit.allows(base, 1, 'node');
  const disclosure = permit.allows(
    { ...base, disclosureRevision: 2 },
    2,
    'node',
  );
  now = -1;
  const discontinuity = permit.allows(base, 2, 'node');
  now = 0;
  assert({
    given: 'stale attempts, mismatched bases/floors or a backwards clock',
    should: 'fail closed permanently until current facts restore authority',
    actual: [
      stale,
      floor,
      disclosure,
      discontinuity,
      permit.allows(base, 2, 'node'),
    ],
    expected: [false, false, false, false, false],
  });
});
