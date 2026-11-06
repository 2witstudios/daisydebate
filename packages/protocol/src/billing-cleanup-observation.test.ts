import { assert, setupRitewayBun, test } from 'riteway/bun';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import { cleanupWork } from './billing-cleanup';
import {
  initial,
  empty,
  claimed,
  context,
  first,
} from './billing-cleanup.test-support';
setupRitewayBun();

test('verified customer deletion cannot acknowledge an owed observation or missing current obligation facts', () => {
  let cleared = initial();
  for (const time of [0, 2, 4, 6]) cleared = empty(cleared, time);
  const value = claimed(cleared, 8);
  const event = {
    kind: 'deleted' as const,
    claimId: first,
    work: cleanupWork(value)!,
  };
  const effects = {
    mappedCustomers: 0,
    possiblePurchases: 0,
    retainedFinancialRoutes: 1,
    owedObservations: false,
  };
  const results = [
    undefined,
    { ...effects, owedObservations: true },
    effects,
  ].map((facts) =>
    advanceCleanup(value, event, {
      ...context(8.1),
      ...(facts === undefined ? {} : { effects: facts }),
    }),
  );
  assert({
    given:
      'scan exhaustion and a verified deleted customer while an invoice/payment obligation may remain',
    should:
      'require affirmative current absence of owed observations, while retaining financial routing separately from the zero-effects promise',
    actual: [
      results.map((result) => result.kind),
      advanceCleanup(
        value,
        { ...event, kind: 'no-effects' },
        { ...context(8.1), effects },
      ).kind,
    ],
    expected: [['idle', 'idle', 'complete'], 'idle'],
  });
});
