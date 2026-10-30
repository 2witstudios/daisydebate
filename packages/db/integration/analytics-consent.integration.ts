import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  analyticsConsentOperations,
  analyticsConsentPrivacyAdopter,
} from '../src/analytics-consent';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';
import { createId } from '@paralleldrive/cuid2';
import { deliverPrivacyJob } from '../src/privacy/vendor-jobs';
import { erasePrivacySubject } from '../src/privacy/subject-rights';
import { subjectRightsVerificationBindings } from '../src/privacy/verification-bindings';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('account consent is isolated, replaceable, exportable and erasable', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const other = await createAuthorizationSubject(fixture);
    const db = drizzle({ client: fixture.sql });
    const operations = analyticsConsentOperations(db);
    const now = '2026-10-30T15:00:00.000Z';
    const consent = {
      version: 1,
      necessary: 'granted',
      analytics: 'granted',
      replay: 'unanswered',
    } as const;
    await operations.saveAnalyticsConsent({
      userId: subject.userId,
      consent,
      now,
    });
    assert({
      given: 'one account grants optional analytics',
      should: 'keep the other account unanswered',
      actual: await operations.readAnalyticsConsent(other.userId),
      expected: null,
    });
    await operations.saveAnalyticsConsent({
      userId: subject.userId,
      consent: { ...consent, analytics: 'denied' },
      now,
    });
    assert({
      given: 'a subsequent refusal',
      should: 'replace capture permission while preserving the hidden category',
      actual: await operations.readAnalyticsConsent(subject.userId),
      expected: { ...consent, analytics: 'denied' },
    });
    await db.transaction(async (tx) => {
      const exported = await analyticsConsentPrivacyAdopter.export(tx, subject);
      assert({
        given: 'a subject export',
        should: 'include only their own consent record',
        actual: exported.consent_record?.map((row) => row.user_id),
        expected: [subject.userId],
      });
      await analyticsConsentPrivacyAdopter.erase(tx, subject, { now });
    });
    assert({
      given: 'subject erasure',
      should: 'remove consent data',
      actual: await operations.readAnalyticsConsent(subject.userId),
      expected: null,
    });
    await fixture.sql`update users set deleted_at=now(),email=null,name='',image=null where id=${subject.userId}`;
    await assertRejects({
      given: 'a stale consent write after account erasure',
      should: 'refuse recreation',
      actual: () =>
        operations.saveAnalyticsConsent({
          userId: subject.userId,
          consent,
          now,
        }),
      code: 'AUTHORIZATION',
    });
  });
});

test('withdrawal deletion and later account erasure fence old vendor acknowledgements', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const database = drizzle({ client: fixture.sql });
    const operations = analyticsConsentOperations(database);
    const now = '2026-10-30T15:00:00.000Z';
    const retryAt = '2026-10-30T15:01:00.000Z';
    const withdrawal = createId();
    const erasure = createId();
    try {
      await operations.saveAnalyticsConsent({
        userId: subject.userId,
        consent: {
          version: 1,
          necessary: 'granted',
          analytics: 'denied',
          replay: 'unanswered',
        },
        now,
        deletionJobId: withdrawal,
      });
      let started = () => {};
      let release = () => {};
      const selected = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const older = deliverPrivacyJob(
        database,
        { jobId: withdrawal, vendor: 'posthog', now, retryAt },
        {
          erase: async () => {
            started();
            await held;
          },
        },
      );
      await selected;
      await erasePrivacySubject(
        database,
        { subject, now, vendors: ['posthog'], jobIds: [erasure] },
        {
          closeRoom: (room) => room,
          eraseSeats: (room) => room,
          activeRoomMembers: () => [],
        },
        subjectRightsVerificationBindings,
      );
      release();
      await older;
      const [pending] =
        await fixture.sql`select id,status from privacy_jobs where subject_ref=${subject.userId} and vendor='posthog'`;
      assert({
        given:
          'account erasure commits while an older withdrawal deletion is in flight',
        should:
          'retain the fresh deletion generation after the old vendor acknowledgement',
        actual: pending,
        expected: { id: erasure, status: 'pending' },
      });
      const result = await deliverPrivacyJob(
        database,
        { jobId: erasure, vendor: 'posthog', now, retryAt },
        { erase: async () => {} },
      );
      assert({
        given:
          'the current deletion generation receives vendor acknowledgement',
        should: 'complete its durable job',
        actual: result,
        expected: 'succeeded',
      });
    } finally {
      await fixture.sql`delete from privacy_jobs where subject_ref=${subject.userId}`;
    }
  });
});
