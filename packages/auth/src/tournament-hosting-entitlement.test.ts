import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  tournamentHostingGrantSchema,
  type TournamentHostingGrant,
} from '@daisy/protocol';
import { currentEntitlementGrants } from './entitlement-validity';
import { accountEntitlements } from './account-entitlements';
import { subscriptionGrants } from './subscription-policy';
setupRitewayBun();
const id = (value: string) => value.repeat(24);
const startsAt = '2026-11-01T00:00:00.000Z';
const expiresAt = '2026-12-01T00:00:00.000Z';
const grant: TournamentHostingGrant = {
  entitlement: 'tournament_hosting',
  source: 'administrative',
  hosting: {
    id: id('v'),
    userId: id('u'),
    version: 1,
    startsAt,
    expiresAt,
    issuer: {
      kind: 'administrative',
      serviceId: 'daisy-admin',
      operatorRef: id('i'),
      decisionReference: 'DEC409 explicit grant',
    },
    coverage: {
      tournamentIds: [id('t')],
      sponsorConcurrencyLimit: 1,
      tournamentConcurrencyLimit: 1,
    },
  },
};
test('hosting is independently finite and never bundles Premium', () => {
  assert({
    given: 'an administrative hosting version without any ordinary entitlement',
    should:
      'admit only its half-open interval and grant no AI, casual capture, download or analysis',
    actual: {
      intervals: [
        '2026-10-31T23:59:59.999Z',
        startsAt,
        expiresAt,
        'invalid',
      ].map(
        (now) =>
          currentEntitlementGrants([grant], { now, betaGrantsPremium: false })
            .length,
      ),
      premium: accountEntitlements([grant], {
        now: startsAt,
        betaGrantsPremium: true,
      }),
    },
    expected: {
      intervals: [0, 1, 0, 0],
      premium: {
        roundAnalysis: false,
        casualAiJudge: false,
        casualCapture: false,
        recordingDownload: false,
      },
    },
  });
});
test('hosting requires independently named provenance, bounded coverage and positive capacity', () => {
  const altered = (hosting: unknown) => ({ ...grant, hosting });
  assert({
    given:
      'missing issuer/validity, duplicate tournaments, nonpositive capacity, beta source and mismatched subscription source',
    should: 'refuse every malformed hosting grant',
    actual: [
      altered({ ...grant.hosting, issuer: null }),
      altered({ ...grant.hosting, expiresAt: startsAt }),
      altered({
        ...grant.hosting,
        coverage: {
          ...grant.hosting.coverage,
          tournamentIds: [id('t'), id('t')],
        },
      }),
      altered({
        ...grant.hosting,
        coverage: { ...grant.hosting.coverage, sponsorConcurrencyLimit: 0 },
      }),
      { ...grant, source: 'beta' },
      { ...grant, source: 'subscription' },
    ].map((value) => tournamentHostingGrantSchema.safeParse(value).success),
    expected: [false, false, false, false, false, false],
  });
});
test('ordinary verified subscription never automatically issues hosting', () => {
  const evidence = {
    lifecycle: 'active',
    settlement: {
      kind: 'paid',
      invoiceId: 'in_verified',
      period: { subscriptionId: id('s'), startsAt, endsAt: expiresAt },
    },
  } as const;
  assert({
    given: 'the ordinary paid Premium projection',
    should: 'retain exactly its five explicit capabilities',
    actual: subscriptionGrants(evidence).map((value) => value.entitlement),
    expected: [
      'round_analysis',
      'ai_rounds',
      'casual_ai_judge',
      'casual_capture',
      'recording_download',
    ],
  });
});
