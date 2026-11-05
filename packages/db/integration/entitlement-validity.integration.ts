import { requireTestServices } from '@daisy/config';
import { accountEntitlements, admitAllowance } from '@daisy/auth/authorization';
import { entitlementKinds } from '@daisy/protocol';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readEntitlementGrants } from '../src/entitlement-grants';
import { lockAuthorizationActors } from '../src/authorization';
import { createAuthorizationSubject } from './authorization.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const startsAt = '2026-11-01T00:00:00.000Z';
const expiresAt = '2026-12-01T00:00:00.000Z';

test('PostgreSQL grants expire at every capability read without a synchronization worker', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    await fixture.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
      select ${subject.userId}, kind, 'subscription', ${startsAt}::timestamptz, ${expiresAt}::timestamptz
      from unnest(${`{${entitlementKinds.join(',')}}`}::text[]) as kind`;
    const database = drizzle({ client: fixture.sql });
    const evaluate = (now: string, betaGrantsPremium: boolean) =>
      database.transaction(async (tx) => {
        const [account] = await lockAuthorizationActors(tx, [subject.actorId], {
          maxActors: 1,
        });
        const grants = await readEntitlementGrants(tx, subject.userId);
        const policy = { now, betaGrantsPremium, betaMonthlyCap: 5 };
        return [
          ...Object.values(accountEntitlements(grants, policy)),
          admitAllowance(
            account ?? null,
            {
              billing: {
                lifecycle: 'active',
                settlement: {
                  kind: 'paid',
                  invoiceId: 'in_verified',
                  period: {
                    subscriptionId: 'subscription',
                    startsAt,
                    endsAt: expiresAt,
                  },
                },
              },
              grants: grants,
              usage: [
                { kind: 'ai_round', source: { kind: 'lifetime' }, spent: 1 },
              ],
              freeBotRoundId: null,
            },
            { kind: 'bot_debate', roundId: 'round', withJudge: false },
            policy,
          ).kind,
        ];
      });
    const before = await readEntitlementGrants(database, subject.userId);
    const actual = [
      await evaluate(startsAt, false),
      await evaluate(expiresAt, false),
      await evaluate(expiresAt, true),
    ];
    const after = await readEntitlementGrants(database, subject.userId);
    assert({
      given:
        'paid and beta grants in real PostgreSQL, unchanged while the injected time crosses paid expiry',
      should:
        'expire all paid capabilities at the edge, retain enabled beta only, and require no worker write',
      actual: {
        capabilities: actual,
        unchanged: JSON.stringify(before) === JSON.stringify(after),
      },
      expected: {
        capabilities: [
          [true, true, true, true, 'admit'],
          [false, false, false, false, 'refuse'],
          [true, true, true, true, 'admit'],
        ],
        unchanged: true,
      },
    });
  });
});

test('PostgreSQL refuses unbounded or malformed subscription validity', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const userId = await fixture.user();
    const insert = (source: string, start: string | null, end: string | null) =>
      rejectedBy(
        () =>
          fixture.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
        values(${userId},'round_analysis',${source},${start}::timestamptz,${end}::timestamptz)`,
      );
    assert({
      given:
        'missing, reversed, zero-length or infinite paid bounds and time-bounded beta grants',
      should: 'reject every invalid source/validity combination at persistence',
      actual: await Promise.all(
        (
          [
            ['subscription', null, expiresAt],
            ['subscription', startsAt, null],
            ['subscription', expiresAt, startsAt],
            ['subscription', startsAt, startsAt],
            ['subscription', startsAt, 'infinity'],
            ['beta', startsAt, expiresAt],
          ] as const
        ).map(([source, start, end]) => insert(source, start, end)),
      ),
      expected: Array.from(
        { length: 6 },
        () => 'account_entitlement_grants_validity_check',
      ),
    });
  });
});
