import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advanceRefund,
  nextRefundWork,
  type RefundAction,
} from '@daisy/protocol/billing';
import { createRefundVendor } from './refund-vendor';
import { createRefundReconciliation } from './refund-reconciliation';
import { refundFixture } from './refund.test-support';
setupRitewayBun();
type Input = Parameters<typeof createRefundReconciliation>[0];
const fixture = refundFixture();
const page = {
  rows: [{ actionId: fixture.base.id }],
  afterId: fixture.base.id,
  exhausted: true,
};
function store(): Input['store'] {
  return {
    actions: async () => page,
    claim: async () => ({ work: 'create', action: fixture.action }),
    record: async () => 'changed',
  };
}

test('action-owned refund reconciliation keeps original key and rechecks late failures after prior success without customer/job discovery', async () => {
  let current: RefundAction = fixture.base,
    instant = fixture.now,
    sequence = 0;
  const calls: unknown[] = [],
    failures: unknown[] = [];
  const clock = { now: () => instant };
  const vendor = createRefundVendor({
    mode: 'test',
    clock,
    port: {
      create: async (parameters, key) => {
        calls.push(['create', parameters, key]);
        return { ...fixture.refund, status: 'succeeded' };
      },
      retrieve: async (id) => {
        calls.push(['retrieve', id]);
        return {
          ...fixture.refund,
          status: sequence === 2 ? 'failed' : 'requires_action',
        };
      },
      list: async () => {
        throw Error('Unexpected discover');
      },
    },
  });
  const worker = createRefundReconciliation({
    mode: 'test',
    vendor,
    failed: (error, stage) => failures.push([error, stage]),
    store: {
      actions: async () => page,
      claim: async () => {
        const context = { now: instant, authority: 'closed' as const };
        const work = nextRefundWork(current, context);
        const transition = advanceRefund(
          current,
          {
            kind: 'claim',
            claimId: String.fromCharCode(97 + sequence++).repeat(24),
          },
          context,
        );
        if (transition.kind !== 'changed') throw Error('Claim fixture refused');
        current = transition.action;
        return { work, action: current };
      },
      record: async (_id, event) => {
        const transition = advanceRefund(current, event, {
          now: instant,
          authority: 'closed',
        });
        if (transition.kind !== 'changed') return transition.kind;
        current = transition.action;
        return 'changed';
      },
    },
  });
  await worker.run();
  const succeeded = current.state;
  instant = '2026-11-05T00:00:04.000Z';
  await worker.run();
  const failed = current.state;
  instant = '2026-11-05T00:00:05.000Z';
  await worker.run();
  assert({
    given:
      'one original-charge action surviving customer deletion/job acknowledgement and later bank return',
    should:
      'create once with its original key, independently retrieve the same refund and retain failed/action-required observations without replacement',
    actual: [
      calls,
      succeeded,
      failed,
      current.state,
      current.chargeId,
      current.period,
      failures,
    ],
    expected: [
      [
        [
          'create',
          {
            charge: fixture.base.chargeId,
            amount: 1000,
            metadata: { daisy_refund_action_id: fixture.base.id },
          },
          `daisy-closure-refund:${fixture.base.id}`,
        ],
        ['retrieve', fixture.refund.id],
        ['retrieve', fixture.refund.id],
      ],
      {
        kind: 'known',
        startedAt: fixture.now,
        refundId: fixture.refund.id,
        status: 'succeeded',
        observedAt: fixture.now,
      },
      {
        kind: 'known',
        startedAt: fixture.now,
        refundId: fixture.refund.id,
        status: 'failed',
        observedAt: '2026-11-05T00:00:04.000Z',
      },
      {
        kind: 'known',
        startedAt: fixture.now,
        refundId: fixture.refund.id,
        status: 'requires_action',
        observedAt: instant,
      },
      fixture.base.chargeId,
      fixture.base.period,
      [],
    ],
  });
});

test('bounded action scans advance past failed identities, preserve unknown accounting and revisit head without customer/job dependence', async () => {
  const scanned: unknown[] = [],
    records: unknown[] = [],
    failures: string[] = [];
  const worker = createRefundReconciliation({
    mode: 'test',
    failed: (_error, stage) => failures.push(stage),
    vendor: {
      run: async () => ({ kind: 'unresolved', claimId: fixture.claimId }),
    },
    store: {
      ...store(),
      actions: async (input) => {
        scanned.push(input);
        return input.afterId
          ? { rows: [], afterId: null, exhausted: true }
          : {
              rows: [{ actionId: 'bad' }, { actionId: fixture.base.id }],
              afterId: fixture.base.id,
              exhausted: false,
            };
      },
      claim: async (id) => {
        if (id === 'bad') throw Error('Controlled claim failure');
        return { work: 'create', action: fixture.action };
      },
      record: async (id, event) => {
        records.push([id, event]);
        return 'changed';
      },
    },
  });
  await worker.run();
  await worker.run();
  await worker.run();
  assert({
    given:
      'an action claim fails before a different original charge with unknown transport outcome',
    should:
      'bound each scan, advance durable keyset discovery, retain unresolved action outcome and periodically revisit head',
    actual: [scanned, records, failures],
    expected: [
      [
        { mode: 'test', limit: 3 },
        { mode: 'test', limit: 3, afterId: fixture.base.id },
        { mode: 'test', limit: 3 },
      ],
      Array(2).fill([
        fixture.base.id,
        { kind: 'unresolved', claimId: fixture.claimId },
      ]),
      ['claim', 'vendor', 'claim', 'vendor'],
    ],
  });
});

test('shutdown during refund transport still accounts for its original result and starts no later effect', async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const calls: unknown[] = [],
    failures: unknown[] = [];
  const worker = createRefundReconciliation({
    mode: 'test',
    failed: (error, stage) => failures.push([error, stage]),
    vendor: {
      run: async () => {
        entered.resolve();
        await release.promise;
        return {
          kind: 'observe',
          claimId: fixture.claimId,
          refundId: fixture.refund.id,
          status: 'succeeded',
        };
      },
    },
    store: {
      ...store(),
      actions: async () => ({
        rows: [{ actionId: fixture.base.id }, { actionId: 'later' }],
        afterId: 'later',
        exhausted: true,
      }),
      claim: async (id) => {
        calls.push(['claim', id]);
        return { work: 'create', action: fixture.action };
      },
      record: async (id, event) => {
        calls.push(['record', id, event]);
        return 'changed';
      },
    },
  });
  const run = worker.run();
  try {
    await Promise.race([
      entered.promise,
      run.then(() => {
        throw Error('Worker exited before transport');
      }),
    ]);
    worker.stop();
  } finally {
    release.resolve();
    await run;
  }
  await worker.run();
  assert({
    given: 'shutdown arrives after a refund request starts',
    should:
      'finish bounded accounting of the original result and dispatch no second action',
    actual: [calls, failures],
    expected: [
      [
        ['claim', fixture.base.id],
        [
          'record',
          fixture.base.id,
          {
            kind: 'observe',
            claimId: fixture.claimId,
            refundId: fixture.refund.id,
            status: 'succeeded',
          },
        ],
      ],
      [],
    ],
  });
});
