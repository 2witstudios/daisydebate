import { assert, setupRitewayBun, test } from 'riteway/bun';
import { usageKinds } from '@daisy/protocol/billing';
import { allowanceVerdict } from './allowance';
import { allowanceCeilings } from './allowance-ceilings';

setupRitewayBun();

const verdict = (
  tier: 'free' | 'premium',
  kind: (typeof usageKinds)[number],
  usedToday: number,
  usedThisPeriod: number,
) => allowanceVerdict({ tier, kind, usedToday, usedThisPeriod });

test('a free account has one of each AI feature, ever', () => {
  assert({
    given: 'a free account with no use, then one use, of each kind',
    should: 'allow the first and refuse the second as the free limit',
    actual: usageKinds.map((kind) => [
      verdict('free', kind, 0, 0),
      verdict('free', kind, 0, 1),
      verdict('free', kind, 1, 1),
    ]),
    expected: usageKinds.map(() => [
      'allow',
      'free-limit-reached',
      'free-limit-reached',
    ]),
  });
});

test('Premium is unlimited up to the per-day abuse ceiling of each kind', () => {
  const ceiling = allowanceCeilings.premiumPerDay;
  assert({
    given:
      'Premium one below, at and above each ceiling today, and a huge period total',
    should:
      'allow below the ceiling, refuse at and above it, and never count the period',
    actual: usageKinds.map((kind) => [
      verdict('premium', kind, ceiling[kind] - 1, 10_000),
      verdict('premium', kind, ceiling[kind], 0),
      verdict('premium', kind, ceiling[kind] + 1, 0),
    ]),
    expected: usageKinds.map(() => ['allow', 'abuse-ceiling', 'abuse-ceiling']),
  });
});

test('the ceilings sit well above human use', () => {
  assert({
    given: 'the trusted ceilings',
    should:
      'allow at least 12 bot Rounds and 24 judged or analysed Rounds a day',
    actual: [
      allowanceCeilings.premiumPerDay.ai_round >= 12,
      allowanceCeilings.premiumPerDay.casual_ai_judge >= 24,
      allowanceCeilings.premiumPerDay.round_analysis >= 24,
      allowanceCeilings.freeLifetime,
    ],
    expected: [true, true, true, 1],
  });
});

test('a test may pass tighter ceilings without touching the trusted config', () => {
  assert({
    given: 'a ceiling of two bot Rounds a day',
    should: 'refuse the third',
    actual: allowanceVerdict(
      { tier: 'premium', kind: 'ai_round', usedToday: 2, usedThisPeriod: 2 },
      {
        freeLifetime: 1,
        premiumPerDay: { ...allowanceCeilings.premiumPerDay, ai_round: 2 },
      },
    ),
    expected: 'abuse-ceiling',
  });
});
