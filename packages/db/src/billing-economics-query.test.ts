import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBillingEconomicsReader } from './billing-economics';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
setupRitewayBun();

test('the actual reader query distinguishes missing token knowledge without changing served outcomes or recorded positive counters', async () => {
  const instanceId = 'a'.repeat(24),
    startsAt = '2026-10-01T00:00:00.000Z',
    endsAt = '2026-11-01T00:00:00.000Z';
  const snapshot = {
    startsAt,
    endsAt,
    observedAt: '2026-11-06T00:00:00.000Z',
    usage: [],
    attempts: [
      {
        sourceKind: 'lifetime',
        sourceStartsAt: null,
        sourceEndsAt: null,
        feature: 'ai_round',
        model: 'recorded-model',
        provider: 'openrouter',
        firstAt: startsAt,
        lastAt: startsAt,
        runs: 1,
        knownResponses: 1,
        unmeasuredResponses: 1,
        unknownCalls: 0,
        definiteFailures: 0,
        inputTokens: 0,
        outputTokens: 0,
        characters: 0,
      },
    ],
  };
  const statements: SQL[] = [];
  // Captures the real emitted statement only; no SQL is executed and no service/role proof is claimed.
  const tx = {
    execute: async (query: SQL) => {
      statements.push(query);
      return [{ instance_id: instanceId, snapshot }];
    },
  } as unknown as BoundedTransactionContext;
  const run: BoundedTransaction = async (work) =>
    work(tx, new AbortController().signal, {
      receivedAt: snapshot.observedAt,
      writer: { pid: 1, backendStart: snapshot.observedAt },
    });
  const result = await createBillingEconomicsReader({ run, instanceId }).read({
    startsAt,
    endsAt,
  });
  const query =
    statements
      .map((s) => new PgDialect().sqlToQuery(s).sql.replace(/\s+/g, ''))
      .find((s) => s.includes('withagent_factsas(')) ?? '';
  assert({
    given:
      'the actual query built by the current-service reader, captured through its injected transaction edge',
    should:
      'project a separate zero-pair knowledge count while retaining served-response/unknown-call facts and positive counter sums',
    actual: [
      /count\(\*\)filter\(whereknownistrueandinput_tokens=0andoutput_tokens=0\)asunmeasured_responses/.test(
        query,
      ),
      query.includes("'unmeasuredResponses',unmeasured_responses"),
      query.includes('count(*)filter(whereknownistrue)asknown_responses'),
      query.includes('sum(input_tokens)filter(whereknownistrue)'),
      result.attempts.map((a) => [
        a.knownResponses,
        a.unmeasuredResponses,
        a.unknownCalls,
      ]),
    ],
    expected: [true, true, true, true, [[1, 1, 0]]],
  });
});
