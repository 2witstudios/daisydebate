import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { messagingBetaLimits } from '@daisy/protocol';
import { parseMessagingPolicyLimits } from './beta-limits';
setupRitewayBun();

const within = {
  bounds: { messageUnits: 4000, pageItems: 100 },
  maxBodyBytes: 65536,
  social: {
    bounds: { introductionUnits: 500, titleUnits: 80, batchActors: 50 },
  },
};

test('a messaging policy is accepted only within the DEC-124 beta limits', async () => {
  assert({
    given: 'a policy exactly at every beta limit',
    should: 'return it unchanged',
    actual: parseMessagingPolicyLimits(within),
    expected: within,
  });
  assert({
    given: 'a policy without social routes',
    should: 'check only its core bounds and body size',
    actual: parseMessagingPolicyLimits({ ...within, social: undefined }),
    expected: { ...within, social: undefined },
  });
  for (const [given, policy] of [
    [
      'a JSON body above 64 KiB',
      { ...within, maxBodyBytes: messagingBetaLimits.bodyBytes + 1 },
    ],
    [
      'a message limit above 4,000 units',
      { ...within, bounds: { ...within.bounds, messageUnits: 4001 } },
    ],
    [
      'a group title limit above 80 units',
      {
        ...within,
        social: { bounds: { ...within.social.bounds, titleUnits: 81 } },
      },
    ],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse the policy before any route composes',
      actual: async () => parseMessagingPolicyLimits(policy),
      code: 'VALIDATION',
    });
});
