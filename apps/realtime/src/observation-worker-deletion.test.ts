import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationWorker } from './observation-worker';
import type { ObservationHeader } from '@daisy/protocol';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';
setupRitewayBun();
const resource = observationTestResource;
const base = observationTestBase();
const header: ObservationHeader = {
  resource,
  contentRevision: 1,
  disclosureRevision: 1,
  purgeGeneration: 0,
};

test('a header that disappears drops cached content instead of counting as unchanged', async () => {
  let present = true;
  const calls: string[] = [];
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'token',
    cache: {
      ready: async () => true,
      claim: async () => true,
      prepare: async () => true,
      publish: async () => true,
      release: async () => {
        calls.push('release');
      },
      drop: async (_resource, token) => {
        calls.push(`drop:${token}`);
        return true;
      },
    },
    readHeaders: async () => (present ? [header] : []),
    build: async () => {
      calls.push('build');
      return { header, body: 'body' };
    },
  });
  await worker.replaceDemand(resource, [base]);
  await worker.reconcile();
  await worker.settled();
  present = false;
  await worker.reconcile();
  await worker.reconcile();
  assert({
    given: 'an owned resource whose durable header is deleted with it',
    should:
      'drop its cached heads and bodies under the owner token once and stop owning it',
    actual: calls,
    expected: ['build', 'drop:token'],
  });
});
