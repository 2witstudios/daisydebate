import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationWorker } from './observation-worker';
import {
  createObservationNode,
  type ObservationSnapshot,
} from './observation-node';
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
for (const audience of [1, 100, 10000, 100000])
  for (const fanout of [1, 4, 40]) {
    test(`shared content work at ${audience} logical sinks across ${fanout} nodes`, async () => {
      let headerRows = 0,
        builds = 0,
        revision = 1,
        enqueues = 0,
        accepted = 0,
        refused = 0;
      let shared: ObservationSnapshot | null = null;
      const nodes = Array.from({ length: fanout }, (_, index) =>
        createObservationNode({
          nodeIncarnation: `node-${index}`,
          now: () => 0,
          yieldWork: async () => {},
          cache: { demand: async () => {}, read: async () => shared },
        }),
      );
      const part = observationEvidence({
        started: 0,
        remainingMs: 5000,
        fingerprint: 'canonical',
        dependencies: [],
      });
      const permits = nodes.map((_, index) => {
        const permit = createObservationPermit({
          now: () => 0,
          nodeIncarnation: `node-${index}`,
        });
        permit.install(permit.begin(), {
          base,
          minimumContentRevision: 1,
          purgeGeneration: 0,
          subject: part,
          cohort: part,
          entitlement: part,
        });
        return permit;
      });
      for (let index = 0; index < audience; index++) {
        const node = index % fanout;
        try {
          nodes[node]!.observe(base, permits[node]!, () => {
            enqueues++;
          });
          accepted++;
        } catch {
          refused++;
        }
      }
      const worker = createObservationWorker({
        eligible: true,
        now: () => 0,
        nextToken: () => 'owner',
        cache: {
          claim: async () => true,
          prepare: async () => true,
          ready: async () => shared !== null,
          publish: async (snapshot, variant) => {
            shared = { base: variant, ...snapshot.header, body: snapshot.body };
            return true;
          },
          release: async () => {},
        },
        readHeaders: async (resources) => {
          headerRows += resources.length;
          return [
            {
              resource: base.resource,
              contentRevision: revision,
              disclosureRevision: 1,
              purgeGeneration: 0,
            },
          ];
        },
        build: async (_base, header) => {
          builds++;
          return { header, body: 'small' };
        },
      });
      worker.demand(base);
      for (revision = 1; revision <= 3; revision++) {
        await worker.reconcile();
        await worker.settled();
        for (const node of nodes) {
          await node.repair();
          await node.settled();
        }
      }
      assert({
        given:
          'fixed resource/variant/revisions/eligible-worker count with independently sized audience and fanout fleet',
        should:
          'keep header/build work flat, deliver every admitted sink and report capacity refusal',
        actual: { headerRows, builds, enqueues, accepted, refused },
        expected: {
          headerRows: 3,
          builds: 3,
          enqueues: accepted * 3,
          accepted: Math.min(audience, fanout * 5000),
          refused: Math.max(0, audience - fanout * 5000),
        },
      });
      for (const node of nodes) node.close();
      await worker.close();
    });
  }
