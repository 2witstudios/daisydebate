import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  accountEntitlements,
  aiRoundAllowance,
  authorize,
} from './authorization';
import { input } from './channel.test-support';
setupRitewayBun();

const account = input.context.account!;
/** Approved, pending, revoked and absent beta facts, then no account. */
const betaVariants = [
  { ...account, beta: { state: 'approved' as const, revision: 1 } },
  { ...account, beta: { state: 'pending' as const, revision: 1 } },
  { ...account, beta: { state: 'revoked' as const, revision: 2 } },
  { ...account, beta: null },
  null,
];

test('coaching premium is only the approved beta grant today', () => {
  const variants = betaVariants;
  assert({
    given: 'current account beta states and the trusted grant switch',
    should: 'grant coaching only while approved and explicitly enabled',
    actual: [true, false].map((betaGrantsPremium) =>
      variants.map(
        (a) => accountEntitlements(a, { betaGrantsPremium }).coaching,
      ),
    ),
    expected: [
      [true, false, false, false, false],
      [false, false, false, false, false],
    ],
  });
});

test('the AI-round allowance is the flat cap for approved beta members only', () => {
  const variants = [
    ...betaVariants.slice(0, 4),
    { ...account, beta: { state: 'approved' as const, revision: 0 } },
    {
      ...account,
      erased: true,
      beta: { state: 'approved' as const, revision: 1 },
    },
    {
      ...account,
      member: false,
      beta: { state: 'approved' as const, revision: 1 },
    },
    null,
  ];
  assert({
    given: 'every canonical account fact and the trusted cap',
    should: 'grant the cap only to a live approved member, and never infer one',
    actual: variants.map((a) => aiRoundAllowance(a, { monthlyCap: 20 })),
    expected: [20, null, null, null, null, null, null, null],
  });
  assert({
    given: 'a coaching grant switched off',
    should: 'leave the separate AI-round quota unchanged',
    actual: [
      accountEntitlements(variants[0]!, { betaGrantsPremium: false }).coaching,
      aiRoundAllowance(variants[0]!, { monthlyCap: 20 }),
    ],
    expected: [false, 20],
  });
});

test('an AI-round allowance needs a positive trusted cap', () => {
  expect(() =>
    aiRoundAllowance(input.context.account!, { monthlyCap: 0 }),
  ).toThrow('A positive monthly AI-round cap is required');
});

test('coaching authorization never gates the official round read', () => {
  const resource = {
    kind: 'round' as const,
    roundId: 'round',
    createdByActorId: 'a',
    visibility: 'public' as const,
    status: 'completed',
    revision: 1,
    participants: [
      {
        actorId: input.context.account!.actorId!,
        role: 'affirmative',
        slot: 0,
      },
    ],
  };
  const evaluate = (coaching: boolean, role = 'affirmative') =>
    (
      ['round.read', 'round.coaching.read', 'round.coaching.generate'] as const
    ).map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource: {
            ...resource,
            participants: resource.participants.map((p) => ({ ...p, role })),
          },
          context: { ...input.context, entitlements: { coaching } },
        }).allow,
    );
  assert({
    given: 'entitled or ordinary debaters and a judge seat',
    should:
      'restrict coaching to entitled debaters while keeping the official result available',
    actual: [evaluate(true), evaluate(false), evaluate(true, 'judge')],
    expected: [
      [true, true, true],
      [true, false, false],
      [true, false, false],
    ],
  });
});

test('premium spectators, host-only members and judges cannot read or generate coaching', () => {
  const actorId = input.context.account!.actorId!;
  const scenarios = [
    {
      given: 'spectator with no seat',
      createdByActorId: 'another-host',
      participants: [],
    },
    {
      given: 'spectator while another member debates',
      createdByActorId: 'another-host',
      participants: [
        { actorId: 'other-debater', role: 'affirmative', slot: 0 },
      ],
    },
    {
      given: 'host without a debating seat',
      createdByActorId: actorId,
      participants: [],
    },
    {
      given: 'seated judge',
      createdByActorId: actorId,
      participants: [{ actorId, role: 'judge', slot: 0 }],
    },
  ];
  for (const scenario of scenarios) {
    const actual = (
      ['round.read', 'round.coaching.read', 'round.coaching.generate'] as const
    ).map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource: {
            kind: 'round',
            roundId: 'round',
            status: 'completed',
            visibility: 'public',
            revision: 1,
            createdByActorId: scenario.createdByActorId,
            participants: scenario.participants,
          },
          context: { ...input.context, entitlements: { coaching: true } },
        }).allow,
    );
    assert({
      given: `an approved premium ${scenario.given}`,
      should:
        'preserve the official read while refusing both coaching capabilities',
      actual,
      expected: [true, false, false],
    });
  }
});

test('premium entitlement cannot replace durable participant admission', () => {
  const account = input.context.account!;
  assert({
    given: 'an approved premium debater without a durable age record',
    should: 'deny coaching through canonical participant admission',
    actual: authorize({
      ...input,
      capability: 'round.coaching.generate',
      resource: {
        kind: 'round',
        roundId: 'round',
        createdByActorId: account.actorId!,
        visibility: 'public',
        status: 'completed',
        revision: 1,
        participants: [
          { actorId: account.actorId!, role: 'affirmative', slot: 0 },
        ],
      },
      context: {
        account: { ...account, ageBand: null },
        entitlements: { coaching: true },
      },
    }).allow,
    expected: false,
  });
});
