import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';
import { testHeader, testWorker } from './observation-worker.test-support';
setupRitewayBun();
const resource = observationTestResource;
const base = observationTestBase();

test('a header that disappears drops cached content instead of counting as unchanged', async () => {
  let present = true;
  const calls: string[] = [];
  const worker = testWorker({
    nextToken: () => 'token',
    cache: {
      release: async () => {
        calls.push('release');
      },
      drop: async (_resource, token) => {
        calls.push(`drop:${token}`);
        return true;
      },
    },
    readHeaders: async () => (present ? [testHeader] : []),
    build: async () => {
      calls.push('build');
      return { header: testHeader, body: 'body' };
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
