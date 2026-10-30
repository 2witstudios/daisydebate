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
