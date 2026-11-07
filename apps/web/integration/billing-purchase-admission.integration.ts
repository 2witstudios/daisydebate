import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { admitParticipants } from '@daisy/db/testing';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { withSql, testDatabaseUrl } from './fixtures';
import { api, signed } from '../src/features/operator-api/router.test-support';
import { createRequestFlagReader } from '../src/features/flags/reader';
import { createPurchaseAdmission } from '../src/features/billing/purchase-admission';

requireTestServices(process.env);
setupRitewayBun();

test('real Billing admission consumes fresh Flags authority while a cached display decision cannot create a purchase', async () =>
  withSql(async (sql) => {
    const userId = createId(),
      actorId = createId();
    const database = createDatabase({
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const key = 'premium-checkout';
    const config = {
      kind: 'stripe' as const,
      mode: 'test' as const,
      secretKey: 'sk_test_unused',
      webhookSecret: 'whsec_unused',
      premiumPriceId: 'price_fixture',
      portalConfigurationId: 'bpc_fixture',
    };
    const admit = createPurchaseAdmission({
      database,
      config,
      returnOrigin: 'https://daisy.example',
    });
    const subject = { userId, actorId };
    try {
      await sql`insert into users(id,username,email_verified) values(${userId},${userId},true)`;
      await sql`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
      await admitParticipants(sql, [userId]);
      const { handle } = api({ store: database, nextId: createId });
      await assertRejects({
        given: 'beta without Stripe configuration',
        should: 'refuse new purchases',
        code: 'NOT_FOUND',
        actual: () =>
          createPurchaseAdmission({
            database,
            config: { kind: 'disabled' },
            returnOrigin: 'https://daisy.example',
          })(subject),
      });
      await assertRejects({
        given: 'a nullable display subject',
        should: 'supply no purchase authority',
        code: 'AUTHENTICATION',
        actual: () => admit(null),
      });
      await assertRejects({
        given: 'the actual default-dark premium-checkout catalogue key',
        should: 'refuse a new purchase',
        code: 'NOT_FOUND',
        actual: () => admit(subject),
      });
      const update = async (
        expectedRevision: number,
        state: 'enabled' | 'killed',
      ) =>
        handle(
          signed({
            method: 'PUT',
            path: `/operator/v1/flags/${key}/state`,
            body: JSON.stringify({
              v: 1,
              commandId: createId(),
              expectedRevision,
              adminAuditHead: 'a'.repeat(64),
              state,
            }),
          }),
        );
      const enabled = await update(0, 'enabled');
      const display = createRequestFlagReader({
        read: database.readFlagSnapshot,
        now: Date.now,
        diagnostic: () => {},
      });
      const shown = await display(key, userId);
      const killed = await update(1, 'killed');
      const cached = await display(key, userId);
      await assertRejects({
        given:
          'a formerly true request-cached display read followed by signed kill',
        should: 'refuse durable purchase admission under fresh Flags authority',
        code: 'NOT_FOUND',
        actual: () => admit(subject),
      });
      const [before] =
        await sql`select count(*)::int as n from billing_purchases where user_id=${userId}`;
      const reenabled = await update(2, 'enabled');
      const results = await Promise.all([admit(subject), admit(subject)]);
      const [grants] =
        await sql`select count(*)::int as n from account_entitlement_grants where user_id=${userId} and source='subscription'`;
      assert({
        given:
          'actual signed state changes, cached display and concurrent Billing operations',
        should:
          'write exactly one server-owned offer only after fresh enable and grant no paid access',
        actual: [
          enabled.status,
          killed.status,
          reenabled.status,
          shown,
          cached,
          before!.n,
          results.map((r) => r.kind).sort(),
          new Set(results.map((r) => r.purchase.id)).size,
          results[0]!.purchase.priceId,
          grants!.n,
        ],
        expected: [
          200,
          200,
          200,
          true,
          true,
          0,
          ['admitted', 'existing'],
          1,
          'price_fixture',
          0,
        ],
      });
    } finally {
      await database.close();
      await sql`delete from billing_purchases where user_id=${userId}`;
      await sql`delete from flag_change_events where key=${key}`;
      await sql`delete from operator_command_receipts where action in ('flag.state.update','flag.override.update') and result->>'key'=${key}`;
      await sql`delete from flag_account_overrides where key=${key}`;
      await sql`delete from release_flags where key=${key}`;
      await sql`delete from account_entitlement_grants where user_id=${userId}`;
      await sql`delete from account_age where user_id=${userId}`;
      await sql`delete from account_beta_access where user_id=${userId}`;
      await sql`delete from actors where id=${actorId}`;
      await sql`delete from users where id=${userId}`;
    }
  }));
