import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runPrivacyErasure } from '../src/privacy/operations';
import type { PrivacyAdopter } from '../src/privacy/contracts';
import { deliverPrivacyJob } from '../src/privacy';
import { owedPrivacyJobs } from '../src/privacy/vendor-jobs';
import { bindings, now, withPrivacySubject } from './privacy.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const adoption: readonly PrivacyAdopter[] = [];
test('configured vendor outage cannot reverse committed local erasure', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    const subject = { userId, actorId };
    const retryAt = '2026-10-09T18:01:00.000Z';
    const observer = new SQL(databaseUrl, { max: 1 });
    try {
      const owedBefore = await owedPrivacyJobs(database);
      const result = await runPrivacyErasure(
        database,
        { subject, now, vendors: ['posthog'], jobIds: [jobId] },
        adoption,
        bindings,
      );
      const owedBeforeAnyAttempt =
        (await owedPrivacyJobs(database)) - owedBefore;
      let observedCommit = false;
      const retry = await deliverPrivacyJob(
        database,
        { jobId, vendor: 'posthog', now, retryAt },
        {
          erase: async (subjectRef) => {
            const rows = await observer.unsafe(
              'select email, deleted_at is not null as erased from users where id=$1',
              [subjectRef],
            );
            observedCommit =
              rows[0]?.erased === true && rows[0]?.email === null;
            throw new Error('private vendor outage payload');
          },
        },
      );
      const owedInBackoff = await owedPrivacyJobs(database);
      const pending = await client.unsafe(
        'select subject_ref,vendor,status,attempts from privacy_jobs where id=$1',
        [jobId],
      );
      const success = await deliverPrivacyJob(
        database,
        {
          jobId,
          vendor: 'posthog',
          now: retryAt,
          retryAt: '2026-10-09T18:02:00.000Z',
        },
        { erase: async () => {} },
      );
      const finished = await client.unsafe(
        'select status,attempts,succeeded_at is not null as acknowledged from privacy_jobs where id=$1',
        [jobId],
      );
      assert({
        given: 'a committed subject tombstone and configured vendor failure',
        should:
          'retain a durable retry, then acknowledge without restoring local data',
        actual: [
          result.jobs.length,
          observedCommit,
          owedBeforeAnyAttempt >= 1,
          owedInBackoff >= 1,
          retry,
          pending[0],
          success,
          finished[0],
        ],
        expected: [
          1,
          true,
          true,
          true,
          'retry',
          {
            subject_ref: userId,
            vendor: 'posthog',
            status: 'pending',
            attempts: 1,
          },
          'succeeded',
          { status: 'succeeded', attempts: 2, acknowledged: true },
        ],
      });
    } finally {
      await client.unsafe('delete from privacy_jobs where subject_ref=$1', [
        userId,
      ]);
      await observer.close();
    }
  });
});

test('two runners failing the same vendor attempt count it once', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    try {
      await runPrivacyErasure(
        database,
        {
          subject: { userId, actorId },
          now,
          vendors: ['posthog'],
          jobIds: [jobId],
        },
        adoption,
        bindings,
      );
      // Both runners have read the job before either vendor call fails.
      let reading = 0;
      let bothRead!: () => void;
      const together = new Promise<void>((resolve) => (bothRead = resolve));
      const failing = () =>
        deliverPrivacyJob(
          database,
          {
            jobId,
            vendor: 'posthog',
            now,
            retryAt: '2026-10-09T18:01:00.000Z',
          },
          {
            erase: async () => {
              if (++reading === 2) bothRead();
              await together;
              throw new Error('vendor outage');
            },
          },
        );
      const outcomes = await Promise.all([failing(), failing()]);
      const [job] = await client.unsafe(
        'select status, attempts from privacy_jobs where id=$1',
        [jobId],
      );
      assert({
        given: 'two runners that read one pending job and both fail it',
        should: 'record one retry and one attempt, the other finding nothing',
        actual: [[...outcomes].sort(), job],
        expected: [['idle', 'retry'], { status: 'pending', attempts: 1 }],
      });
    } finally {
      await client.unsafe('delete from privacy_jobs where subject_ref=$1', [
        userId,
      ]);
    }
  });
});
