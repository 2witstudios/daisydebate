import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refundIdempotencyKey } from './billing-refund';
import {
  at,
  first,
  second,
  third,
  fourth,
  action,
  context,
  changed,
} from './billing-refund.test-support';
import { advanceRefund, nextRefundWork } from './billing-refund-lifecycle';

setupRitewayBun();
test('lost refund replies retain one action and key beyond vendor idempotency retention', () => {
  const original = action();
  const claimed = changed(original, { kind: 'claim', claimId: first }, 3);
  const unknown = changed(claimed, { kind: 'unresolved', claimId: first }, 4);
  const retry = changed(unknown, { kind: 'claim', claimId: second }, 9);
  assert({
    given:
      'a failed reply and subsequent retry of the original charge obligation',
    should:
      'keep immutable identity/source and first possible execution with a key independent of cleanup jobs',
    actual: [
      refundIdempotencyKey(original),
      refundIdempotencyKey(retry),
      'startedAt' in retry.state ? retry.state.startedAt : null,
      nextRefundWork(unknown, context(8)),
      nextRefundWork(unknown, context(9)),
      nextRefundWork(retry, context(172800)),
    ],
    expected: [
      `daisy-closure-refund:${original.id}`,
      `daisy-closure-refund:${original.id}`,
      at(3),
      'wait',
      'create',
      'discover',
    ],
  });
  assert({
    given: 'an old worker response after a replacement claim',
    should: 'refuse without replacing the newer authority',
    actual: advanceRefund(
      retry,
      {
        kind: 'observe',
        claimId: first,
        refundId: 're_original',
        status: 'succeeded',
      },
      context(10),
    ),
    expected: { kind: 'refuse' },
  });
});

test('fresh refund observations can reopen succeeded obligations; reversed reads cannot hide late failure', () => {
  const claimed = changed(action(), { kind: 'claim', claimId: first }, 3);
  const succeeded = changed(
    claimed,
    {
      kind: 'observe',
      claimId: first,
      refundId: 're_original',
      status: 'succeeded',
    },
    4,
  );
  const reread = changed(succeeded, { kind: 'claim', claimId: second }, 172800);
  const failed = changed(
    reread,
    {
      kind: 'observe',
      claimId: second,
      refundId: 're_original',
      status: 'failed',
    },
    172801,
  );
  const later = changed(failed, { kind: 'claim', claimId: third }, 172802);
  const needsAction = changed(
    later,
    {
      kind: 'observe',
      claimId: third,
      refundId: 're_original',
      status: 'requires_action',
    },
    172803,
  );
  assert({
    given:
      'success, a much later verified failure and applicable action-required observation',
    should:
      'retain one action/refund/source while allowing owed status to reopen without another create',
    actual: [
      nextRefundWork(succeeded, context(86400)),
      failed.state.kind === 'known' ? failed.state.status : null,
      needsAction.state.kind === 'known' ? needsAction.state.status : null,
      needsAction.id,
      needsAction.period,
      refundIdempotencyKey(needsAction),
    ],
    expected: [
      'retrieve',
      'failed',
      'requires_action',
      action().id,
      action().period,
      refundIdempotencyKey(action()),
    ],
  });
  assert({
    given: 'the old success arriving after the fresh failure',
    should: 'refuse the obsolete read and a different refund identity',
    actual: [
      advanceRefund(
        failed,
        {
          kind: 'observe',
          claimId: first,
          refundId: 're_original',
          status: 'succeeded',
        },
        context(172802),
      ),
      advanceRefund(
        later,
        {
          kind: 'observe',
          claimId: third,
          refundId: 're_other',
          status: 'succeeded',
        },
        context(172803),
      ),
    ],
    expected: [{ kind: 'refuse' }, { kind: 'refuse' }],
  });
});

test('an empty refund scan never releases uncertainty and claim expiry refuses late writes', () => {
  const claimed = changed(action(), { kind: 'claim', claimId: first }, 3);
  const scanning = changed(claimed, { kind: 'claim', claimId: second }, 303);
  const empty = changed(
    scanning,
    {
      kind: 'searched',
      claimId: second,
      beforeRefundId: null,
      afterRefundId: null,
    },
    304,
  );
  assert({
    given: 'no matching refund after the original creation window',
    should:
      'keep possible execution and require another read rather than a new refund',
    actual: [
      empty.state.kind,
      'startedAt' in empty.state ? empty.state.startedAt : null,
      nextRefundWork(empty, context(309)),
      advanceRefund(
        scanning,
        {
          kind: 'observe',
          claimId: second,
          refundId: 're_original',
          status: 'succeeded',
        },
        context(333),
      ),
      nextRefundWork(empty, { now: at(309), authority: 'denied' }),
    ],
    expected: ['unknown', at(3), 'discover', { kind: 'refuse' }, 'refuse'],
  });
});

test('refund creation cutoff and discovery cursor never refresh original dispatch authority', () => {
  const initial = changed(action(), { kind: 'claim', claimId: first }, 3);
  const finalClaim = changed(initial, { kind: 'claim', claimId: second }, 302);
  const discovery = changed(finalClaim, { kind: 'claim', claimId: third }, 303);
  const page = changed(
    discovery,
    {
      kind: 'searched',
      claimId: third,
      beforeRefundId: null,
      afterRefundId: 're_page1',
    },
    304,
  );
  const next = changed(page, { kind: 'claim', claimId: fourth }, 309);
  assert({
    given: 'last-second creation followed by a bounded discovery page',
    should:
      'cap creation at its original cutoff and refuse a stale or nonprogressing cursor',
    actual: [
      finalClaim.claim?.expiresAt,
      discovery.claim?.work,
      page.state.kind === 'unknown' ? page.state.afterRefundId : null,
      advanceRefund(
        next,
        {
          kind: 'searched',
          claimId: fourth,
          beforeRefundId: null,
          afterRefundId: 're_page2',
        },
        context(310),
      ),
      advanceRefund(
        next,
        {
          kind: 'searched',
          claimId: fourth,
          beforeRefundId: 're_page1',
          afterRefundId: 're_page1',
        },
        context(310),
      ),
    ],
    expected: [
      at(303),
      'discover',
      're_page1',
      { kind: 'refuse' },
      { kind: 'refuse' },
    ],
  });
});
