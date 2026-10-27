import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { MessagingPolicyOverride } from '@daisy/config';
import { messagingBetaLimits } from '@daisy/protocol';
import {
  betaMessagingPolicy,
  dec251MessagingValues,
  tightenMessagingPolicy,
  tightenMessagingValues,
} from './beta-policy';
import { parseMessagingPolicyLimits } from './beta-limits';
import { requirePrivateGroups } from './private-groups';

setupRitewayBun();

test('the shipped beta policy is DEC-251, frozen, within DEC-124', () => {
  assert({
    given: 'the composed beta messaging policy',
    should:
      'carry every DEC-251 number, pass the DEC-124 limits and refuse mutation',
    actual: [
      betaMessagingPolicy.limits.actorSend,
      betaMessagingPolicy.limits.read,
      betaMessagingPolicy.editWindowMs,
      betaMessagingPolicy.limits.typing,
      betaMessagingPolicy.typing.ttlMs,
      betaMessagingPolicy.limits.reactions,
      betaMessagingPolicy.reactions.distinctPerMessage,
      betaMessagingPolicy.social.requests,
      betaMessagingPolicy.limits.fileUploadsDaily,
      parseMessagingPolicyLimits(betaMessagingPolicy) === betaMessagingPolicy,
      Object.isFrozen(dec251MessagingValues.send[0]),
    ],
    expected: [
      [
        { max: 10, windowSeconds: 10 },
        { max: 30, windowSeconds: 60 },
        { max: 600, windowSeconds: 3_600 },
      ],
      [{ max: 120, windowSeconds: 60 }],
      900_000,
      [{ max: 1, windowSeconds: 3 }],
      6_000,
      [{ max: 60, windowSeconds: 60 }],
      10,
      {
        daily: 20,
        unrelatedHourly: 5,
        declinesToBlock: 3,
        declineBlockMs: 2_592_000_000,
      },
      20,
      true,
      true,
    ],
  });
  assert({
    given: 'the beta posting policy',
    should:
      'admit 16+ members only (DEC-251), sized at the DEC-124 message limit',
    actual: [
      betaMessagingPolicy.posting,
      betaMessagingPolicy.bounds.messageUnits,
      betaMessagingPolicy.maxBodyBytes,
    ],
    expected: [
      {
        state: 'approved',
        decision: 'DEC-251',
        key: 'social.dm',
        revision: 1,
        allowedBandPairs: [
          ['adult', 'adult'],
          ['16-17', '16-17'],
          ['16-17', 'adult'],
        ],
      },
      messagingBetaLimits.messageUnits,
      messagingBetaLimits.bodyBytes,
    ],
  });
});

test('private groups are off in the beta policy, whatever group policy is supplied (ISSUE-643)', async () => {
  for (const policy of [
    betaMessagingPolicy,
    {
      ...betaMessagingPolicy,
      groupPosting: betaMessagingPolicy.posting,
      social: {
        ...betaMessagingPolicy.social,
        groupAdmission: betaMessagingPolicy.posting,
      },
    },
  ])
    await assertRejects({
      given: 'the beta policy, alone or with an approved group policy',
      should: 'refuse private-group creation, invitation and admission',
      actual: async () => requirePrivateGroups(policy),
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'the beta policy',
    should: 'compose no group posting or admission at all',
    actual: [
      betaMessagingPolicy.groupPosting,
      betaMessagingPolicy.social.groupAdmission,
    ],
    expected: [undefined, undefined],
  });
});

test('a deployment override may only tighten DEC-251', async () => {
  const tightened = tightenMessagingPolicy(betaMessagingPolicy, {
    editWindowMs: 60_000,
    send: [
      { max: 5, windowSeconds: 10 },
      { max: 30, windowSeconds: 60 },
      { max: 100, windowSeconds: 3_600 },
    ],
    reactions: { distinctPerMessage: 3 },
    socialRequests: { daily: 10, declineBlockMs: 3_000_000_000 },
  });
  assert({
    given: 'no override, then tighter values',
    should: 'keep the shipped policy as is, then apply each value to its field',
    actual: [
      tightenMessagingPolicy(betaMessagingPolicy, undefined) ===
        betaMessagingPolicy,
      tightened.editWindowMs,
      tightened.limits.actorSend.map((rule) => rule.max),
      tightened.reactions.distinctPerMessage,
      tightened.social.requests,
      tightened.limits.read,
    ],
    expected: [
      true,
      60_000,
      [5, 30, 100],
      3,
      {
        daily: 10,
        unrelatedHourly: 5,
        declinesToBlock: 3,
        declineBlockMs: 3_000_000_000,
      },
      [{ max: 120, windowSeconds: 60 }],
    ],
  });
  for (const [given, override] of [
    ['a longer edit window', { editWindowMs: 900_001 }],
    ['a higher hourly send', { send: [{ max: 601, windowSeconds: 3_600 }] }],
    [
      'a different window length',
      {
        send: [
          { max: 10, windowSeconds: 10 },
          { max: 30, windowSeconds: 60 },
          { max: 600, windowSeconds: 7_200 },
        ],
      },
    ],
    ['more distinct reactions', { reactions: { distinctPerMessage: 11 } }],
    ['a faster typing signal', { typing: [{ max: 2, windowSeconds: 3 }] }],
    ['more daily requests', { socialRequests: { daily: 21 } }],
    ['a shorter decline block', { socialRequests: { declineBlockMs: 1 } }],
    ['more uploads', { fileUploadsDaily: 21 }],
  ] satisfies [string, MessagingPolicyOverride][])
    await assertRejects({
      given,
      should: 'refuse the whole policy at boot rather than clamp it',
      actual: async () =>
        tightenMessagingValues(dec251MessagingValues, override),
      code: 'VALIDATION',
    });
});
