import { assertRejects } from '@daisy/errors/testing';
import type { RoundAnalysisAccess } from '@daisy/db/rounds';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';
import { createRoundAnalysisOperations } from './operations';

setupRitewayBun();

const seat = { roundId: 'round', roundParticipantId: 'seat' };
const claim = {
  token: 't',
  attempt: 1,
  model: 'analysis-model',
  seat: { ...seat, side: 'affirmative' as const, slot: 1 },
  round,
  frozen,
  history: [],
};
const access = (
  grants: RoundAnalysisAccess['grants'],
): RoundAnalysisAccess => ({
  round: {
    kind: 'round',
    roundId: 'round',
    createdByActorId: 'actor',
    status: 'completed',
    visibility: 'public',
    revision: 1,
    participants: [{ actorId: 'actor', role: 'affirmative', slot: 1 }],
  },
  seat: { id: 'seat', actorId: 'actor', side: 'affirmative', slot: 1 },
  account: {
    userId: 'user',
    actorId: 'actor',
    member: true,
    erased: false,
    revision: 1,
    beta: { state: 'approved', revision: 1 },
    ageBand: 'adult',
  },
  grants,
});
const entitled = [{ entitlement: 'round_analysis', source: 'beta' }] as const;

const harness = (
  answer: string,
  options: {
    readonly claimed?: typeof claim | null;
    readonly betaGrantsPremium?: boolean;
    readonly grants?: RoundAnalysisAccess['grants'];
  } = {},
) => {
  const calls: unknown[] = [];
  const operations = createRoundAnalysisOperations({
    betaGrantsPremium: options.betaGrantsPremium ?? true,
    store: {
      claimRoundAnalysisJob: async (target, decide) => {
        // The policy decides on facts the store reads under its lock.
        const decision = decide(
          {
            status: 'completed',
            completedAt: '2026-10-26T12:00:00.000Z',
            frozen: true,
            lines: 1,
            analysis: null,
          },
          access(options.grants ?? entitled),
        );
        calls.push(['claim', target.roundParticipantId, decision]);
        return (
          decision === 'claim'
            ? options.claimed === undefined
              ? claim
              : options.claimed
            : null
        ) as never;
      },
      recordRoundAnalysisUsage: async (target, token, usage) => {
        calls.push(['usage', target.roundParticipantId, token, usage]);
      },
      completeRoundAnalysisJob: async (target, token, result) => {
        calls.push(['complete', target.roundParticipantId, token, result]);
      },
    },
    voice: () => ({
      complete: async (request) => {
        calls.push([
          'provider',
          request.model,
          request.messages
            .map((m) => m.content)
            .join('\n')
            .includes('Analyse the affirmative debater in slot 1'),
        ]);
        return { text: answer, promptTokens: 120, completionTokens: 40 };
      },
    }),
    withProvider: (_signal, work) => work(),
    now: () => '2026-10-26T12:01:00.000Z',
  });
  return { calls, operations };
};

test('a claimed seat is analysed once, its usage recorded before its report', async () => {
  const { calls, operations } = harness(JSON.stringify(report));
  await operations.analyse(seat, new AbortController().signal);
  assert({
    given: 'a claimable seat and a valid report citing a frozen line',
    should:
      'claim it, call the analysis model once for that seat, record its usage, then store the report under the lease',
    actual: calls,
    expected: [
      ['claim', 'seat', 'claim'],
      ['provider', 'analysis-model', true],
      ['usage', 'seat', 't', { inputTokens: 120, outputTokens: 40 }],
      ['complete', 'seat', 't', report],
    ],
  });
});

test('an invalid answer is paid for but never stored', async () => {
  const { calls, operations } = harness('Great round!');
  await assertRejects({
    given: 'an answer that is not the report contract',
    should: 'refuse with INFRASTRUCTURE',
    actual: () => operations.analyse(seat, new AbortController().signal),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the refused answer',
    should: 'still record its usage and store no report',
    actual: calls.map((call) => (call as unknown[])[0]),
    expected: ['claim', 'provider', 'usage'],
  });
});

test('a seat another process holds is left alone', async () => {
  const { calls, operations } = harness(JSON.stringify(report), {
    claimed: null,
  });
  await operations.analyse(seat, new AbortController().signal);
  assert({
    given: 'a seat whose claim is refused',
    should: 'make no provider call',
    actual: calls,
    expected: [['claim', 'seat', 'claim']],
  });
});

test('a cancelled claim buys nothing', async () => {
  const { calls, operations } = harness(JSON.stringify(report));
  const abort = new AbortController();
  abort.abort();
  await assertRejects({
    given: 'a claim whose worker is stopping',
    should: 'refuse with CONFLICT',
    actual: () => operations.analyse(seat, abort.signal),
    code: 'CONFLICT',
  });
  assert({
    given: 'the cancelled claim',
    should: 'claim nothing and make no provider call',
    actual: calls,
    expected: [],
  });
});

test('a debater without the entitlement never costs a provider call', async () => {
  for (const [given, options] of [
    ['a beta grant with the premium switch off', { betaGrantsPremium: false }],
    ['approved beta state with no round analysis grant', { grants: [] }],
  ] as const) {
    const { calls, operations } = harness(JSON.stringify(report), options);
    await operations.analyse(seat, new AbortController().signal);
    assert({
      given,
      should: 'skip the claim and make no paid call',
      actual: calls,
      expected: [['claim', 'seat', 'skip']],
    });
  }
});
