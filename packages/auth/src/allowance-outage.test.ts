import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  AllowanceFacts,
  AllowanceDecision,
  SubscriptionEvidence,
} from '@daisy/protocol/billing';
import { admitAllowance } from './allowance';
import { subscriptionGrants } from './subscription-policy';
import { input } from './channel.test-support';

setupRitewayBun();
const period = {
  subscriptionId: 'subscription_owned',
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
};
const evidence: SubscriptionEvidence = {
  lifecycle: 'past_due',
  settlement: {
    kind: 'renewal_failed',
    invoiceId: 'invoice_failed',
    period: {
      ...period,
      startsAt: period.endsAt,
      endsAt: '2027-01-01T00:00:00.000Z',
    },
    previous: { invoiceId: 'invoice_paid', period },
  },
};
const facts: AllowanceFacts = {
  billing: evidence,
  grants: [
    ...subscriptionGrants(evidence),
    { entitlement: 'ai_rounds', source: 'beta' },
  ],
  usage: [],
  freeBotRoundId: null,
};

test('unchanged verified evidence carries paid-to-grace authority through worker outage', () => {
  const decide = (now: string, betaGrantsPremium: boolean) =>
    admitAllowance(
      input.context.account!,
      facts,
      { kind: 'bot_debate', roundId: 'round_new', withJudge: false },
      { now, betaGrantsPremium, betaMonthlyCap: 20 },
    );
  assert({
    given:
      'failed renewal observed before paid-through, unchanged through grace, with beta and unused lifetime overlap',
    should:
      'use the paid period first, refuse all new bots during grace, and choose other sources only after grace expires',
    actual: [false, true].map((beta) => [
      decide('2026-11-30T23:59:59.999Z', beta),
      decide(period.endsAt, beta),
      decide('2026-12-07T23:59:59.999Z', beta),
      decide('2026-12-08T00:00:00.000Z', beta),
    ]),
    expected: [false, true].map((beta): AllowanceDecision[] => [
      {
        kind: 'admit',
        reservations: [
          {
            kind: 'ai_round',
            source: { kind: 'subscription', ...period },
            limit: 5,
          },
        ],
      },
      { kind: 'refuse', reason: 'renewal-grace' },
      { kind: 'refuse', reason: 'renewal-grace' },
      {
        kind: 'admit',
        reservations: [
          {
            kind: 'ai_round',
            source: beta
              ? {
                  kind: 'beta',
                  startsAt: period.endsAt,
                  endsAt: '2027-01-01T00:00:00.000Z',
                }
              : { kind: 'lifetime' },
            limit: beta ? 20 : 1,
          },
        ],
      },
    ]),
  });
});
