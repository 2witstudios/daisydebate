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
const beta = (entitlement: 'round_analysis' | 'ai_rounds') =>
  ({ entitlement, source: 'beta' }) as const;
const allGrants = [beta('round_analysis'), beta('ai_rounds')];

test('round analysis premium is the account’s own grant fact, never its beta state', () => {
  const grantSets = [allGrants, [beta('ai_rounds')], []];
  assert({
    given:
      'beta-sourced grants with and without round analysis, then none, under the trusted switch',
    should:
      'entitle only a round_analysis grant, and a beta-sourced one only while the switch is on',
    actual: [true, false].map((betaGrantsPremium) =>
      grantSets.map(
        (grants) =>
          accountEntitlements(grants, { betaGrantsPremium }).roundAnalysis,
      ),
    ),
    expected: [
      [true, false, false],
      [false, false, false],
    ],
  });
  assert({
    given: 'an approved beta account with no grant rows',
    should: 'entitle nothing: beta state alone is not premium',
    actual: accountEntitlements([], { betaGrantsPremium: true }).roundAnalysis,
    expected: false,
  });
});

test('the AI-round allowance is the flat cap for live members holding an ai_rounds grant', () => {
  const live = {
    ...account,
    beta: { state: 'approved' as const, revision: 1 },
  };
  const cases = [
    [live, allGrants],
    [live, [beta('round_analysis')]],
    [live, []],
    [{ ...live, erased: true }, allGrants],
    [{ ...live, member: false }, allGrants],
    [null, allGrants],
  ] as const;
  assert({
    given: 'canonical account facts with and without the ai_rounds grant',
    should:
      'grant the cap only to a live member holding the grant, and never infer one',
    actual: cases.map(([a, grants]) =>
      aiRoundAllowance(a, grants, { monthlyCap: 20 }),
    ),
    expected: [20, null, null, null, null, null],
  });
  assert({
    given: 'the round analysis switch off',
    should: 'leave the separate AI-round quota unchanged',
    actual: [
      accountEntitlements(allGrants, { betaGrantsPremium: false })
        .roundAnalysis,
      aiRoundAllowance(live, allGrants, { monthlyCap: 20 }),
    ],
    expected: [false, 20],
  });
});

test('an AI-round allowance needs a positive trusted cap', () => {
  expect(() =>
    aiRoundAllowance(input.context.account!, allGrants, { monthlyCap: 0 }),
  ).toThrow('A positive monthly AI-round cap is required');
});

test('round analysis authorization never gates the official round read', () => {
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
  const evaluate = (roundAnalysis: boolean, role = 'affirmative') =>
    (
      ['round.read', 'round.analysis.read', 'round.analysis.generate'] as const
    ).map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource: {
            ...resource,
            participants: resource.participants.map((p) => ({ ...p, role })),
          },
          context: { ...input.context, entitlements: { roundAnalysis } },
        }).allow,
    );
  assert({
    given: 'entitled or ordinary debaters and a judge seat',
    should:
      'restrict round analysis to entitled debaters while keeping the official result available',
    actual: [evaluate(true), evaluate(false), evaluate(true, 'judge')],
    expected: [
      [true, true, true],
      [true, false, false],
      [true, false, false],
    ],
  });
});

test('premium spectators, host-only members and judges cannot read or generate a round analysis', () => {
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
      ['round.read', 'round.analysis.read', 'round.analysis.generate'] as const
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
          context: { ...input.context, entitlements: { roundAnalysis: true } },
        }).allow,
    );
    assert({
      given: `an approved premium ${scenario.given}`,
      should:
        'preserve the official read while refusing both round analysis capabilities',
      actual,
      expected: [true, false, false],
    });
  }
});

test('premium entitlement cannot replace durable participant admission', () => {
  const account = input.context.account!;
  assert({
    given: 'an approved premium debater without a durable age record',
    should: 'deny round analysis through canonical participant admission',
    actual: authorize({
      ...input,
      capability: 'round.analysis.generate',
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
        entitlements: { roundAnalysis: true },
      },
    }).allow,
    expected: false,
  });
});
