import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationNode } from './observation-node';
import {
  createObservationPermit,
  observationEvidence,
} from './observation-permit';
import type { ObservationBase } from '@daisy/protocol';
setupRitewayBun();
const base: ObservationBase = {
  schema: 1,
  resource: { kind: 'channel', id: 'a'.repeat(24) },
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('one changed body fans out locally and second observer receives baseline', async () => {
  let now = 0,
    fetches = 0,
    demands = 0;
  const received: number[] = [],
    second: number[] = [];
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => now,
    yieldWork: async () => {},
    cache: {
      demand: async () => {
        demands++;
      },
      read: async () => {
        fetches++;
        return { base, contentRevision: 1, purgeGeneration: 0, body: 'body' };
      },
    },
  });
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const evidence = observationEvidence({
    started: 0,
    remainingMs: 5000,
    fingerprint: 'same',
    dependencies: [],
  });
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    subject: evidence,
    cohort: evidence,
    entitlement: evidence,
  });
  node.observe(base, permit, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  await node.repair();
  node.observe(base, permit, (snapshot) =>
    second.push(snapshot.contentRevision),
  );
  await node.settled();
  now = 4900;
  node.accept({ base, contentRevision: 2, purgeGeneration: 0, body: 'new' });
  await node.settled();
  assert({
    given: 'shared content and a newly attached observer then expired permits',
    should:
      'fetch once per base and baseline immediately with zero expired enqueues',
    actual: { fetches, demands, received, second },
    expected: { fetches: 1, demands: 1, received: [1], second: [1] },
  });
});
