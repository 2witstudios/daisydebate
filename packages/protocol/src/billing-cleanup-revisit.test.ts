import { assert, setupRitewayBun, test } from 'riteway/bun';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import {
  billingCleanupSchema,
  cleanupLanes,
  cleanupWork,
  startCleanup,
} from './billing-cleanup';
import {
  at,
  job,
  first,
  claimed,
  context,
} from './billing-cleanup.test-support';
import { owner } from './billing-payment-observation.test-support';
import { billingPaymentObservationSchema } from './billing-payment-observation';
setupRitewayBun();
const effects = {
  mappedCustomers: 0,
  possiblePurchases: 0,
  retainedFinancialRoutes: 1,
  owedFinancialEffects: true,
};

test('retaining an unchanged owed observation with its exact remainder is progress, while unresolved or stale replies cannot advance', () => {
  const observation = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  const later = 'q'.repeat(24);
  const base = billingCleanupSchema.parse({
    version: 2,
    kind: 'scanning',
    invoiceDebt: { kind: 'none' },
    jobId: job,
    retryAt: at(10),
    claim: null,
    turn: 'observations',
    scans: {
      purchases: { kind: 'complete' },
      subscriptions: { kind: 'complete' },
      invoices: { kind: 'complete' },
      refunds: { kind: 'complete' },
      observations: {
        kind: 'selected',
        id: owner.id,
        rest: [later],
        lastId: later,
        more: false,
        detail: { kind: 'resource' },
      },
    },
  });
  const value = claimed(base, 10),
    work = cleanupWork(value)!;
  const event = {
    kind: 'retained' as const,
    claimId: first,
    work,
    observation,
  };
  const authority = {
    ...context(10.1),
    effects,
    observationOwner: { userId: owner.userId, closedAt: owner.closedAt },
  };
  const next = advanceCleanup(value, event, authority);
  const unresolved = advanceCleanup(
    value,
    { kind: 'resolved', claimId: first, work },
    authority,
  );
  const foreign = advanceCleanup(
    value,
    { ...event, observation: { ...observation, id: later } },
    authority,
  );
  assert({
    given:
      'the exact owed row is durably retained with unchanged financial facts and a current selected remainder',
    should:
      'advance one retained identity at fixed due without classifying relief, and refuse generic resolution, mismatched row and stale replay',
    actual: [
      next.kind,
      next.kind === 'progress' &&
        next.state.kind === 'scanning' && [
          next.state.scans.observations,
          next.state.retryAt,
          next.state.claim,
        ],
      observation.state,
      unresolved,
      foreign,
      next.kind === 'progress' && advanceCleanup(next.state, event, authority),
    ],
    expected: [
      'progress',
      [
        {
          kind: 'selected',
          id: later,
          rest: [],
          lastId: later,
          more: false,
          detail: { kind: 'resource' },
        },
        at(11.1),
        null,
      ],
      { kind: 'owed', reason: 'enumeration_unavailable' },
      { kind: 'idle' },
      { kind: 'idle' },
      { kind: 'idle' },
    ],
  });
});

test('new cleanup execution contains five independently bounded discovery/revisit lanes', () => {
  const value = startCleanup(job, at(0));
  assert({
    given:
      'a newly closed subject with possible retained invoice/payment obligations',
    should:
      'start every discovery lane and indexed observation revisit at the head without a claim',
    actual: [cleanupLanes, value],
    expected: [
      ['purchases', 'subscriptions', 'invoices', 'refunds', 'observations'],
      {
        version: 2,
        kind: 'scanning',
        invoiceDebt: { kind: 'none' },
        jobId: job,
        retryAt: at(0),
        claim: null,
        turn: 'purchases',
        scans: Object.fromEntries(
          [
            'purchases',
            'subscriptions',
            'invoices',
            'refunds',
            'observations',
          ].map((lane) => [lane, { kind: 'page', afterId: null }]),
        ),
      },
    ],
  });
});

function finalPage() {
  return claimed(
    billingCleanupSchema.parse({
      version: 2,
      kind: 'scanning',
      invoiceDebt: { kind: 'none' },
      jobId: job,
      retryAt: at(0),
      claim: null,
      turn: 'observations',
      scans: {
        purchases: { kind: 'complete' },
        subscriptions: { kind: 'complete' },
        invoices: { kind: 'complete' },
        refunds: { kind: 'complete' },
        observations: { kind: 'page', afterId: 'o'.repeat(24) },
      },
    }),
    0,
  );
}
test('all-pass traversal with owed identities restarts fair head discovery without pretending vendor deletion eligibility', () => {
  const value = finalPage(),
    event = {
      kind: 'page' as const,
      claimId: first,
      work: cleanupWork(value)!,
      ids: [],
      more: false,
    };
  const progress = advanceCleanup(value, event, { ...context(0.1), effects });
  const absent = advanceCleanup(value, event, context(0.1));
  const settled = advanceCleanup(value, event, {
    ...context(0.1),
    effects: { ...effects, owedFinancialEffects: false },
  });
  assert({
    given:
      'last page exhaustion while exact obligations remain owed, are unknown, or are affirmatively settled',
    should:
      'restart bounded traversal only for owed, refuse unknown facts, and permit deletion phase only for affirmative absence',
    actual: [progress, absent, settled],
    expected: [
      { kind: 'progress', state: startCleanup(job, at(1.1)) },
      { kind: 'idle' },
      {
        kind: 'progress',
        state: {
          version: 2,
          kind: 'deleting',
          jobId: job,
          retryAt: at(1.1),
          claim: null,
        },
      },
    ],
  });
});

test('five-lane failure yielding preserves exact selections and never turns an unresolved observation read into progress', () => {
  let value = billingCleanupSchema.parse({
    version: 2,
    kind: 'scanning',
    invoiceDebt: { kind: 'none' },
    jobId: job,
    retryAt: at(0),
    claim: null,
    turn: 'purchases',
    scans: Object.fromEntries(
      [
        ['purchases', 'p'.repeat(24)],
        ['subscriptions', 'sub_original'],
        ['invoices', 'in_original'],
        ['refunds', 'r'.repeat(24)],
        ['observations', 'o'.repeat(24)],
      ].map(([lane, id]) => [
        lane,
        {
          kind: 'selected',
          id,
          rest: [],
          lastId: id,
          more: false,
          detail:
            lane === 'invoices'
              ? { kind: 'invoice-payments', pass: null }
              : { kind: 'resource' },
        },
      ]),
    ),
  });
  const original = value.kind === 'scanning' && value.scans,
    turns = [];
  for (let index = 0; index < 5; index++) {
    const c = claimed(value, index * 2),
      work = cleanupWork(c)!;
    const next = advanceCleanup(
      c,
      { kind: 'failure', claimId: first, work, retryAt: at(index * 2 + 2) },
      context(index * 2 + 0.1),
    );
    if (next.kind !== 'failure') throw Error('Missing failure yield');
    value = next.state;
    turns.push(value.kind === 'scanning' && value.turn);
  }
  assert({
    given: 'all five lanes selected and every current read/action unresolved',
    should:
      'visit every lane using failure accounting without clearing any exact resource frame',
    actual: [turns, value.kind === 'scanning' && value.scans],
    expected: [
      ['subscriptions', 'invoices', 'refunds', 'observations', 'purchases'],
      original,
    ],
  });
});
