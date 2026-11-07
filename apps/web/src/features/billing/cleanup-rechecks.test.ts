import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupRechecks } from './cleanup-rechecks';
setupRitewayBun();
test('acknowledged cleanup rechecks advance past failed identities and revisit head without replacing financial actions', async () => {
  const pages: unknown[] = [],
    jobs: string[] = [],
    failures: string[] = [];
  let step = 0;
  const worker = createCleanupRechecks({
    failed: (_error, stage) => failures.push(stage),
    store: {
      rechecks: async (cursor) => {
        pages.push(cursor ?? null);
        step++;
        return step === 1
          ? {
              rows: [{ jobId: 'a'.repeat(24) }, { jobId: 'b'.repeat(24) }],
              next: { afterId: 'c'.repeat(24), throughId: 'z'.repeat(24) },
            }
          : { rows: [], next: null };
      },
      reopen: async (id) => {
        jobs.push(id);
        if (id.startsWith('a')) throw Error('Controlled failure');
        return 'changed';
      },
    },
  });
  await worker.run();
  await worker.run();
  await worker.run();
  worker.stop();
  await worker.run();
  assert({
    given:
      'a bounded due-ACK page with one failed and one later closed subject',
    should:
      'continue later identities, advance exact page keyset and revisit head while stopping new admissions after shutdown',
    actual: [pages, jobs, failures],
    expected: [
      [null, { afterId: 'c'.repeat(24), throughId: 'z'.repeat(24) }, null],
      ['a'.repeat(24), 'b'.repeat(24)],
      ['reopen'],
    ],
  });
});
test('page failure and shutdown after an in-flight read do not invent progress or admit a reopened job', async () => {
  const pages: unknown[] = [],
    failures: string[] = [];
  let run = 0,
    reopens = 0;
  const worker = createCleanupRechecks({
    failed: (_error, stage) => failures.push(stage),
    store: {
      rechecks: async (cursor) => {
        pages.push(cursor ?? null);
        if (++run === 1) throw Error('Controlled page failure');
        worker.stop();
        return {
          rows: [{ jobId: 'a'.repeat(24) }],
          next: { afterId: 'a'.repeat(24), throughId: 'z'.repeat(24) },
        };
      },
      reopen: async () => {
        reopens++;
        return 'changed';
      },
    },
  });
  await worker.run();
  await worker.run();
  await worker.run();
  assert({
    given: 'a failed page and a later page reply after shutdown',
    should:
      'retry the same discovery point and mutate no scheduled replacement after stop',
    actual: [pages, failures, reopens],
    expected: [[null, null], ['page'], 0],
  });
});
