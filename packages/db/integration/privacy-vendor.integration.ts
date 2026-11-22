import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { inTransaction } from '../src/tx';
import { enqueuePrivacyJob } from '../src/privacy/enqueue-job';
import { createMessagingTypingPrivacyPort } from '../src/privacy/typing-rights';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runPrivacyErasure } from '../src/privacy/operations';
import type { PrivacyAdopter } from '../src/privacy/contracts';
import { deliverPrivacyJob } from '../src/privacy';
import { duePrivacyJobs, owedPrivacyJobs } from '../src/privacy/vendor-jobs';
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
        "select subject_ref,vendor,status,attempts,to_jsonb(privacy_jobs)::text not like '%private vendor outage payload%' as scrubbed from privacy_jobs where id=$1",
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
        {
          erase: async (subjectRef) => {
            assert({
              given: 'the due job',
              should: 'bind the selected subject',
              actual: subjectRef,
              expected: userId,
            });
          },
        },
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
            scrubbed: true,
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

test('vendor discovery orders due rows and excludes outstanding and finished work', async () => {
  await withPrivacySubject(async ({ client, database, userId }) => {
    const before = createId();
    const next = createId();
    const later = createId();
    const done = createId();
    try {
      await client`insert into privacy_jobs(id,subject_ref,vendor,status,attempts,created_at,retry_at,succeeded_at)
        values (${before},${userId},'beehiiv','pending',3,'2026-01-01','2026-01-01',null),
          (${next},${userId},'posthog','pending',0,'2026-01-01','2026-01-02',null),
          (${later},${userId},'resend','pending',0,'2026-01-01','2026-10-10',null),
          (${done},${userId},'sentry','succeeded',1,'2026-01-01','2026-01-01','2026-01-02')`;
      const page = await duePrivacyJobs(database, { now, limit: 2 });
      assert({
        given: 'two due jobs, a future job and an acknowledged job',
        should: 'return only due jobs in retry order within the limit',
        actual: page.map(({ id, vendor, attempts }) => [id, vendor, attempts]),
        expected: [
          [before, 'beehiiv', 3],
          [next, 'posthog', 0],
        ],
      });
      for (const [jobId, vendor] of [
        [later, 'resend'],
        [done, 'sentry'],
        [next, 'beehiiv'],
      ] as const) {
        assert({
          given: 'a future job, a completed job, or a mismatched vendor',
          should: 'report idle without contacting a vendor',
          actual: await deliverPrivacyJob(
            database,
            { jobId, vendor, now, retryAt: '2026-10-09T18:01:00.000Z' },
            {
              erase: async () => {
                throw new Error('Vendor must not run');
              },
            },
          ),
          expected: 'idle',
        });
      }
    } finally {
      await client`delete from privacy_jobs where subject_ref=${userId}`;
    }
  });
});

test('invalid privacy job inputs and bindings refuse before any vendor action', async () => {
  const client = new SQL(databaseUrl, { max: 1 });
  await client.close();
  const closed = drizzle({ client });
  const input = {
    jobId: createId(),
    vendor: 'posthog',
    now,
    retryAt: '2026-10-09T18:01:00.000Z',
  } as const;
  const port = {
    erase: async () => {
      throw new Error('Vendor must not run');
    },
  };
  for (const change of [
    { jobId: 'invalid' },
    { now: 'invalid' },
    { now: '2026-10-09' },
    { retryAt: now },
  ]) {
    await assertRejects({
      given: 'invalid job identity or deadline and a closed SQL connection',
      should: 'refuse before querying or calling its vendor',
      actual: () => deliverPrivacyJob(closed, { ...input, ...change }, port),
      code: 'VALIDATION',
    });
  }
  for (const change of [
    { now: 'not-a-date' },
    { limit: 0 },
    { limit: 1_000 },
  ]) {
    await assertRejects({
      given: 'invalid discovery bounds and a closed SQL connection',
      should: 'refuse before running a query',
      actual: () => duePrivacyJobs(closed, { now, limit: 16, ...change }),
      code: 'VALIDATION',
    });
  }
  const malformed = `invalid-${createId()}`;
  const writer = new SQL(databaseUrl, { max: 1 });
  try {
    await writer`insert into users(id) values(${malformed})`;
    await writer`insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at)
      values(${input.jobId},${malformed},${input.vendor},${now},${now})`;
    await assertRejects({
      given: 'a malformed persisted job subject',
      should: 'refuse it before calling the vendor',
      actual: () => deliverPrivacyJob(drizzle({ client: writer }), input, port),
      code: 'VALIDATION',
    });
  } finally {
    await writer`delete from privacy_jobs where id=${input.jobId}`;
    await writer`delete from users where id=${malformed}`;
    await writer.close();
  }
});

test('superseded vendor work cannot acknowledge a replacement', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    const retryAt = '2026-10-09T18:01:00.000Z';
    const vendor = 'posthog' as const;
    const enqueue = (id: string) =>
      inTransaction(database, (tx) =>
        enqueuePrivacyJob(tx, {
          id,
          subjectRef: userId,
          vendor,
          createdAt: now,
        }),
      );
    try {
      await runPrivacyErasure(
        database,
        {
          subject: { userId, actorId },
          now,
          vendors: [vendor],
          jobIds: [jobId],
        },
        adoption,
        bindings,
      );
      let current = jobId;
      for (const outage of [false, true]) {
        const replacement = createId();
        const outcome = await deliverPrivacyJob(
          database,
          { jobId: current, vendor, now, retryAt },
          {
            erase: async () => {
              await enqueue(replacement);
              if (outage) throw new Error('private vendor failure');
            },
          },
        );
        const [job] =
          await client`select id, status, attempts from privacy_jobs where subject_ref=${userId} and vendor=${vendor}`;
        assert({
          given: 'a replacement committed while old vendor work was in flight',
          should:
            'report idle and leave its replacement pending regardless of the old outcome',
          actual: [outcome, job],
          expected: [
            'idle',
            { id: replacement, status: 'pending', attempts: 0 },
          ],
        });
        current = replacement;
      }
    } finally {
      await client`delete from privacy_jobs where subject_ref=${userId}`;
    }
  });
});

test('typing privacy delivery only acknowledges physical deletion', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    const vendor = 'messaging-typing' as const;
    const retryAt = '2026-10-09T18:01:00.000Z';
    const calls: string[] = [];
    let outage = true;
    const port = createMessagingTypingPrivacyPort(database, {
      exportSubject: async () => [],
      eraseSubject: async (subject) => {
        calls.push(subject);
        if (outage) throw new Error('private response');
      },
    });
    try {
      await runPrivacyErasure(
        database,
        {
          subject: { userId, actorId },
          now,
          vendors: [vendor],
          jobIds: [jobId],
        },
        adoption,
        bindings,
      );
      const retry = await deliverPrivacyJob(
        database,
        { jobId, vendor, now, retryAt },
        port,
      );
      const [pending] =
        await client`select status, attempts, to_jsonb(privacy_jobs)::text not like '%private response%' as scrubbed from privacy_jobs where id=${jobId}`;
      outage = false;
      const success = await deliverPrivacyJob(
        database,
        { jobId, vendor, now: retryAt, retryAt: '2026-10-09T18:02:00.000Z' },
        port,
      );
      const [finished] =
        await client`select status, attempts from privacy_jobs where id=${jobId}`;
      assert({
        given:
          'an unavailable typing producer followed by a deletion acknowledgement',
        should:
          'keep the retry durable and private, and only then record success',
        actual: [retry, pending, success, finished, calls],
        expected: [
          'retry',
          { status: 'pending', attempts: 1, scrubbed: true },
          'succeeded',
          { status: 'succeeded', attempts: 2 },
          [actorId, actorId],
        ],
      });
    } finally {
      await client`delete from privacy_jobs where subject_ref=${userId}`;
    }
  });
});
