import { requireTestServices } from '@daisy/config';
import {
  currentEntitlementGrants,
  accountEntitlements,
} from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readEntitlementGrants,
  applyBetaEntitlementGrants,
} from '../src/entitlement-grants';
import { withRolledBackDatabase } from '../src/testing-rolled-back';
import { sqlStateOf, rejectedBy } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const startsAt = '2026-11-01T00:00:00.000Z',
  expiresAt = '2026-12-01T00:00:00.000Z';
const coverage = {
  tournamentIds: [],
  sponsorConcurrencyLimit: 1,
  tournamentConcurrencyLimit: 1,
};

test('canonical hosting keeps independently revocable immutable issuer versions without a Premium upgrade', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const userId = createId(),
        issuerId = createId(),
        otherUserId = createId(),
        subscriptionId = createId(),
        adminId = createId(),
        paidId = createId();
      for (const id of [userId, issuerId, otherUserId])
        await sql`insert into users(id,username,email_verified) values(${id},${id},true)`;
      const evidence = {
        lifecycle: 'active',
        settlement: {
          kind: 'paid',
          invoiceId: 'in_verified_hosting',
          period: { subscriptionId, startsAt, endsAt: expiresAt },
        },
      };
      await sql`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,observed_at)
        values(${subscriptionId},${userId},${`sub_${subscriptionId}`},${evidence},true,${startsAt}::timestamptz)`;
      await sql`insert into account_hosting_versions(id,user_id,source,version,starts_at,expires_at,issuer_service_id,issuer_operator_ref,decision_reference,coverage)
        values(${adminId},${userId},'administrative',1,${startsAt}::timestamptz,${expiresAt}::timestamptz,'daisy-admin',${issuerId},'DEC409 explicit operator fixture',${coverage})`;
      await sql`insert into account_hosting_versions(id,user_id,source,version,starts_at,expires_at,subscription_id,subscription_observed_at,subscription_evidence,coverage)
        values(${paidId},${userId},'subscription',1,${startsAt}::timestamptz,${expiresAt}::timestamptz,${subscriptionId},${startsAt}::timestamptz,${evidence},${coverage})`;
      for (const [source, id] of [
        ['administrative', adminId],
        ['subscription', paidId],
      ])
        await sql`insert into account_entitlement_grants(user_id,entitlement,source,hosting_version_id)values(${userId},'tournament_hosting',${source},${id})`;
      return {
        userId,
        otherUserId,
        issuerId,
        subscriptionId,
        adminId,
        paidId,
        evidence,
      };
    },
    work: async (_database, subject, sql) => {
      const db = drizzle({ client: sql });
      const read = () => readEntitlementGrants(db, subject.userId);
      const before = await read();
      assert({
        given:
          'two independently issued versions on the canonical account grant',
        should:
          'retain exact issuer/version/coverage and enforce finite bounds without bundling another feature',
        actual: {
          ids: before
            .filter((g) => g.entitlement === 'tournament_hosting')
            .map((g) => g.hosting.id),
          current: [startsAt, expiresAt].map(
            (now) =>
              currentEntitlementGrants(before, {
                now,
                betaGrantsPremium: false,
              }).length,
          ),
          premium: accountEntitlements(before, {
            now: startsAt,
            betaGrantsPremium: true,
          }),
        },
        expected: {
          ids: [subject.adminId, subject.paidId],
          current: [2, 0],
          premium: {
            roundAnalysis: false,
            casualAiJudge: false,
            casualCapture: false,
            recordingDownload: false,
          },
        },
      });
      const revoke = () =>
        sql.savepoint(async (tx) => {
          await tx.unsafe('reset role');
          await tx`update account_entitlement_grants set revoked_at=${startsAt}::timestamptz where user_id=${subject.userId} and source='administrative'`;
          await tx.unsafe('set local role daisy_web');
        });
      await revoke();
      assert({
        given: 'only administrative source revoked',
        should:
          'leave subscription source current and preserve both immutable version rows',
        actual: {
          sources: (await read()).map((g) => g.source),
          versions: Number(
            (
              await sql`select count(*)::int as n from account_hosting_versions where user_id=${subject.userId}`
            )[0]!.n,
          ),
        },
        expected: { sources: ['subscription'], versions: 2 },
      });
      assert({
        given: 'participant app DML and a foreign account/version pair',
        should:
          'refuse issuance, source edits and nonexistent or cross-account references',
        actual: [
          await sqlStateOf(() =>
            sql.savepoint(
              (tx) =>
                tx`update account_hosting_versions set version=2 where id=${subject.adminId}`,
            ),
          ),
          await sqlStateOf(() =>
            sql.savepoint(
              (tx) =>
                tx`update account_entitlement_grants set revoked_at=null where user_id=${subject.userId} and source='administrative'`,
            ),
          ),
          await rejectedBy(() =>
            sql.savepoint(async (tx) => {
              await tx.unsafe('reset role');
              return tx`insert into account_entitlement_grants(user_id,entitlement,source,hosting_version_id)values(${subject.otherUserId},'tournament_hosting','administrative',${subject.adminId})`;
            }),
          ),
          await rejectedBy(() =>
            sql.savepoint(async (tx) => {
              await tx.unsafe('reset role');
              return tx`update account_entitlement_grants set hosting_version_id=${createId()} where user_id=${subject.userId} and source='subscription'`;
            }),
          ),
        ],
        expected: [
          '42501',
          '42501',
          'account_entitlement_grants_hosting_version_fk',
          'account_entitlement_grants_hosting_version_fk',
        ],
      });
      const falseSources = [];
      for (const variant of [
        'foreign-account',
        'changed-evidence',
        'changed-observation',
        'unpaid',
        'beyond-paid-period',
      ] as const) {
        falseSources.push(
          await rejectedBy(() =>
            sql.savepoint(async (tx) => {
              await tx.unsafe('reset role');
              const subscriptionId =
                variant === 'unpaid' ? createId() : subject.subscriptionId;
              const evidence =
                variant === 'unpaid'
                  ? { lifecycle: 'active', settlement: { kind: 'unpaid' } }
                  : variant === 'changed-evidence'
                    ? {
                        ...subject.evidence,
                        settlement: {
                          ...subject.evidence.settlement,
                          invoiceId: 'in_fabricated',
                        },
                      }
                    : subject.evidence;
              if (variant === 'unpaid')
                await tx`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,observed_at)values(${subscriptionId},${subject.userId},${`sub_${subscriptionId}`},${evidence},false,${startsAt}::timestamptz)`;
              await tx`insert into account_hosting_versions(id,user_id,source,version,starts_at,expires_at,subscription_id,subscription_observed_at,subscription_evidence,coverage)
            values(${createId()},${variant === 'foreign-account' ? subject.otherUserId : subject.userId},'subscription',2,${startsAt}::timestamptz,${variant === 'beyond-paid-period' ? '2027-01-01T00:00:00.000Z' : expiresAt}::timestamptz,${subscriptionId},${variant === 'changed-observation' ? '2026-11-02T00:00:00.000Z' : startsAt}::timestamptz,${evidence},${coverage})`;
            }),
          ),
        );
      }
      assert({
        given:
          'foreign account, forged paid snapshot, changed observation, actual unpaid evidence and excess coverage',
        should:
          'refuse every false or overextended subscription source at the owning database boundary',
        actual: falseSources,
        expected: [
          'account_hosting_versions_verified_subscription',
          'account_hosting_versions_verified_subscription',
          'account_hosting_versions_verified_subscription',
          'account_hosting_versions_paid_evidence',
          'account_hosting_versions_paid_evidence',
        ],
      });
      await applyBetaEntitlementGrants(db, subject.userId, 'approved');
      assert({
        given: 'ordinary beta approval after hosting issuance',
        should:
          'issue only the five ordinary benefits and keep the independent paid hosting source',
        actual: (await read()).map((g) => [g.entitlement, g.source]),
        expected: [
          ['ai_rounds', 'beta'],
          ['casual_ai_judge', 'beta'],
          ['casual_capture', 'beta'],
          ['recording_download', 'beta'],
          ['round_analysis', 'beta'],
          ['tournament_hosting', 'subscription'],
        ],
      });
      // Transaction-local fixture, so retained immutable rows never require destructive cleanup.
    },
  });
});
