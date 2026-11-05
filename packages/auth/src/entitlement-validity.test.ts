import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entitlementKinds, type EntitlementGrant } from '@daisy/protocol';
import { currentEntitlementGrants } from './entitlement-validity';
import { accountEntitlements, aiRoundAllowance } from './account-entitlements';
import { input } from './channel.test-support';

setupRitewayBun();

const startsAt = '2026-11-01T00:00:00.000Z';
const expiresAt = '2026-12-01T00:00:00.000Z';
const paid: readonly EntitlementGrant[] = entitlementKinds.map(
  (entitlement) => ({
    entitlement,
    source: 'subscription',
    startsAt,
    expiresAt,
  }),
);
const beta: readonly EntitlementGrant[] = entitlementKinds.map(
  (entitlement) => ({
    entitlement,
    source: 'beta',
  }),
);

test('every paid capability expires without a webhook or reconciliation worker', () => {
  assert({
    given:
      'the same unchanged grant rows before, during and after their validity period',
    should:
      'admit only the half-open paid interval for all five capabilities, AI allowance included',
    actual: [
      '2026-10-31T23:59:59.999Z',
      startsAt,
      '2026-11-30T23:59:59.999Z',
      expiresAt,
      '2027-01-01T00:00:00.000Z',
    ].map((now) =>
      currentEntitlementGrants(paid, { now, betaGrantsPremium: false }),
    ),
    expected: [[], paid, paid, [], []],
  });
});

test('beta retirement affects every beta benefit without disabling valid paid grants', () => {
  assert({
    given:
      'beta only, paid only, both and neither with beta enabled or retired',
    should: 'filter by each source without turning off the paid subscription',
    actual: [true, false].map((betaGrantsPremium) =>
      [beta, paid, [...beta, ...paid], []].map((grants) =>
        currentEntitlementGrants(grants, { now: startsAt, betaGrantsPremium }),
      ),
    ),
    expected: [
      [beta, paid, [...beta, ...paid], []],
      [[], paid, paid, []],
    ],
  });
});

test('an invalid evaluation time or paid interval grants nothing', () => {
  const broken: readonly EntitlementGrant[] = [
    {
      entitlement: 'ai_rounds',
      source: 'subscription',
      startsAt: expiresAt,
      expiresAt: startsAt,
    },
    {
      entitlement: 'round_analysis',
      source: 'subscription',
      startsAt,
      expiresAt: startsAt,
    },
    {
      entitlement: 'recording_download',
      source: 'subscription',
      startsAt: 'invalid',
      expiresAt,
    },
    {
      entitlement: 'casual_capture',
      source: 'subscription',
      startsAt,
      expiresAt: 'invalid',
    },
  ];
  assert({
    given: 'invalid time, reversed/empty or malformed paid intervals',
    should:
      'fail closed without throwing or treating an invalid end as unlimited',
    actual: [
      currentEntitlementGrants([...beta, ...paid], {
        now: 'invalid',
        betaGrantsPremium: true,
      }),
      currentEntitlementGrants(broken, {
        now: startsAt,
        betaGrantsPremium: true,
      }),
    ],
    expected: [[], []],
  });
});

test('capability and AI allowance consumers use the same outage-safe validity projection', () => {
  const evaluate = (now: string, betaGrantsPremium: boolean) => {
    const policy = { now, betaGrantsPremium, monthlyCap: 5 };
    return {
      ...accountEntitlements([...beta, ...paid], policy),
      aiRounds: aiRoundAllowance(
        input.context.account!,
        [...beta, ...paid],
        policy,
      ),
    };
  };
  const enabled = {
    roundAnalysis: true,
    casualAiJudge: true,
    casualCapture: true,
    recordingDownload: true,
    aiRounds: 5,
  };
  const disabled = {
    roundAnalysis: false,
    casualAiJudge: false,
    casualCapture: false,
    recordingDownload: false,
    aiRounds: null,
  };
  assert({
    given:
      'unchanged paid and beta rows at paid expiry with beta retired or enabled',
    should:
      'expire every paid capability at the same boundary while keeping only explicitly enabled beta benefits',
    actual: [
      evaluate(startsAt, false),
      evaluate(expiresAt, false),
      evaluate(expiresAt, true),
    ],
    expected: [enabled, disabled, enabled],
  });
});
