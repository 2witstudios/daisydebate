import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import {
  withBoundedRound,
  loseTransactionCommitReply,
} from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';

setupRitewayBun();
requireTestServices(process.env);

for (const source of ['lifetime', 'subscription'] as const) {
  test(`two final-use ${source} admissions commit one immutable debit`, async () => {
    await withBoundedRound(async (f, run, roundId) => {
      const other = await f.round();
      const actorId = await admissionSponsor(f, [roundId, other]);
      const [{ user_id: userId }] =
        await f.sql`select user_id from actors where id=${actorId}`;
      await f.sql`delete from account_entitlement_grants where user_id=${userId}`;
      const subscriptionId = createId();
      const startsAt = new Date(Date.now() - 86400000).toISOString();
      const endsAt = new Date(Date.now() + 86400000).toISOString();
      const period = { subscriptionId, startsAt, endsAt };
      try {
        if (source === 'subscription') {
          await f.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
            values(${userId},'ai_rounds','subscription',${startsAt}::timestamptz,${endsAt}::timestamptz)`;
          await f.insert('billing_subscriptions', {
            id: subscriptionId,
            user_id: userId,
            vendor_subscription_id: 'sub_' + subscriptionId,
            current: true,
            observed_at: new Date(),
            evidence: {
              lifecycle: 'active',
              settlement: { kind: 'paid', invoiceId: 'in_quota', period },
            },
          });
          for (let i = 0; i < 4; i++) {
            const prior = await f.round({ created_by_actor_id: actorId });
            await f.insert('usage_reservations', {
              id: createId(),
              actor_id: actorId,
              round_id: prior,
              kind: 'ai_round',
              source: { kind: source, ...period },
              reserved_at: new Date(startsAt),
              state: {
                kind: 'unknown',
                countedAt: startsAt,
                countBasis: 'dispatch_record',
              },
            });
          }
        }
        const admission = testBotAdmission(run);
        const results = await Promise.allSettled(
          [roundId, other].map((roundId) =>
            admission.reserve({ actorId, roundId }),
          ),
        );
        const [row] =
          await f.sql`select count(*)::int as n,count(distinct source)::int as sources from usage_reservations where actor_id=${actorId}`;
        assert({
          given: `two concurrent requests for the last ${source} use`,
          should:
            'admit exactly one under the account fence without falling back to another source',
          actual: [
            results.filter((r) => r.status === 'fulfilled').length,
            row.n,
            row.sources,
          ],
          expected: [1, source === 'subscription' ? 5 : 1, 1],
        });
        if (source === 'subscription') {
          const nextPeriod = {
            subscriptionId,
            startsAt: endsAt,
            endsAt: new Date(Date.now() + 86400000 * 32).toISOString(),
          };
          const [count] =
            await f.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId} and source=${{ kind: 'subscription', ...nextPeriod }}`;
          assert({
            given: 'a distinct verified renewal period',
            should:
              'have no inherited use or transferable refunds from the original period',
            actual: count.n,
            expected: 0,
          });
        }
      } finally {
        await f.sql`delete from billing_subscriptions where id=${subscriptionId}`;
      }
    });
  });
}

test('lost admission COMMIT reply recovers the original reservation without granting another use', async () => {
  await withBoundedRound(async (f, run, roundId, client) => {
    const other = await f.round();
    const actorId = await admissionSponsor(f, [roundId, other]);
    await f.sql`delete from account_entitlement_grants where user_id=(select user_id from actors where id=${actorId})`;
    const admission = testBotAdmission(run);
    const restore = loseTransactionCommitReply(client, 2);
    try {
      await assertRejects({
        given:
          'the database commits admission but the client loses COMMIT reply',
        should: 'report uncertainty rather than a fabricated rollback',
        code: 'INFRASTRUCTURE',
        actual: () => admission.reserve({ actorId, roundId }),
      });
    } finally {
      restore();
    }
    const [original] =
      await f.sql`select id from usage_reservations where actor_id=${actorId} and round_id=${roundId}`;
    const recovered = await admission.reserve({ actorId, roundId });
    assert({
      given: 'a retry after that uncertain result',
      should: 'recover the committed request identity',
      actual: recovered.id,
      expected: original.id,
    });
    await assertRejects({
      given: 'a fresh Round after the lost reply',
      should: 'retain the spent lifetime admission',
      code: 'CONFLICT',
      actual: () => admission.reserve({ actorId, roundId: other }),
    });
  });
});
