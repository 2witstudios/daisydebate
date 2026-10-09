import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { erasePrivacySubject, deliverPrivacyJob } from '../src/privacy';
import { bindings, now, withPrivacySubject } from './privacy.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const adoption = { requiredAdopters: [], adopters: [] };
test('configured vendor outage cannot reverse committed local erasure', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    const subject = { userId, actorId };
    const retryAt = '2026-10-09T18:01:00.000Z';
    const observer = new SQL(databaseUrl, { max: 1 });
    try {
      const result = await erasePrivacySubject(
        database,
        { subject, now, vendors: ['posthog'], jobIds: [jobId] },
        adoption,
        bindings,
      );
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
          retry,
          pending[0],
          success,
          finished[0],
        ],
        expected: [
          1,
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
