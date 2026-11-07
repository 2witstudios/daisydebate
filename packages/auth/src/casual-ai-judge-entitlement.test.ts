import { assert, setupRitewayBun, test } from 'riteway/bun';
import { accountEntitlements } from './account-entitlements';

setupRitewayBun();
const now = '2026-11-05T00:00:00.000Z';

const beta = { entitlement: 'casual_ai_judge', source: 'beta' } as const;

test('the casual AI judge is its own premium fact (WATCH-16)', () => {
  const holds = (
    grants: Parameters<typeof accountEntitlements>[0],
    betaGrantsPremium: boolean,
  ) => accountEntitlements(grants, { betaGrantsPremium, now }).casualAiJudge;
  assert({
    given: 'its beta grant with the premium switch on and off',
    should: 'count only while beta grants premium',
    actual: [holds([beta], true), holds([beta], false)],
    expected: [true, false],
  });
  assert({
    given: 'only the other premium grants',
    should: 'not hold it',
    actual: holds(
      [
        { entitlement: 'round_analysis', source: 'beta' },
        { entitlement: 'ai_rounds', source: 'beta' },
      ],
      true,
    ),
    expected: false,
  });
  assert({
    given: 'only its grant',
    should: 'not grant round analysis',
    actual: accountEntitlements([beta], { betaGrantsPremium: true, now })
      .roundAnalysis,
    expected: false,
  });
});
