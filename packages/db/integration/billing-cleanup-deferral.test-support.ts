import { assert } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork } from '@daisy/protocol/billing';
import type { cleanupCandidate } from './billing-cleanup-candidate.test-support';

export async function exerciseFailureDeferral(
  matrix: ReturnType<typeof cleanupCandidate>,
) {
  const { claim, apply, token, state, now, read, rotate, probe, persist } =
    matrix;
  const ids = [createId(), `sub_${createId()}`, `in_${createId()}`, createId()];
  for (const id of ids) {
    const c = await claim();
    await apply({
      kind: 'page',
      claimId: token(c),
      work: cleanupWork(c)!,
      ids: [id],
      more: false,
    });
  }
  const selected = await state();
  if (selected.kind !== 'scanning')
    throw Error('Expected selected deferral lanes');
  const c = await claim();
  if (c.kind !== 'scanning') throw Error('Expected scanning failure fixture');
  const before = await read();
  const deferredFrame = {
    ...c,
    claim: null,
    retryAt: new Date(Date.parse(await now()) + 500).toISOString(),
    turn: 'subscriptions' as const,
  };
  const skippedTurn = { ...deferredFrame, turn: 'refunds' as const };
  const droppedWork = {
    ...deferredFrame,
    scans: { ...deferredFrame.scans, purchases: { kind: 'complete' as const } },
  };
  assert({
    given:
      'a failure result trying to skip a financial turn or release uncertain selection',
    should: 'reject both23514 and preserve every original queue/frame fact',
    actual: [
      await probe(() => persist(skippedTurn, 'failure')),
      await probe(() => persist(droppedWork, 'failure')),
      await read(),
    ],
    expected: ['23514', '23514', before],
  });
  await apply({
    kind: 'failure',
    claimId: token(c),
    work: cleanupWork(c)!,
    retryAt: new Date(Date.parse(await now()) + 500).toISOString(),
  });
  const deferred = await read();
  assert({
    given:
      'a current failed purchase attempt with four retained selected resource lanes',
    should:
      'consume one failure, preserve all owed identities and yield to cancellation',
    actual: [
      deferred.attempts,
      deferred.billing_cleanup.turn,
      deferred.billing_cleanup.scans,
      deferred.billing_cleanup.claim,
    ],
    expected: [1, 'subscriptions', selected.scans, null],
  });
  const visited: unknown[] = [];
  for (let index = 0; index < 3; index++) {
    const current = await claim(),
      work = cleanupWork(current)!;
    visited.push(work.kind === 'scan' && work.lane);
    await apply(
      work.kind === 'scan' && work.lane === 'invoices'
        ? {
            kind: 'payments',
            claimId: token(current),
            work,
            beforeId: null,
            afterId: null,
            exhausted: true,
          }
        : { kind: 'resolved', claimId: token(current), work },
    );
  }
  const next = await state();
  assert({
    given:
      'subsequent selected cancellation, invoice/payment and refund results in the same durable scan',
    should: 'exercise each turn and retain the original unresolved purchase',
    actual: [
      visited,
      next.kind === 'scanning' && next.scans.purchases,
      next.kind === 'scanning' && next.turn,
      (await read()).attempts,
    ],
    expected: [
      ['subscriptions', 'invoices', 'refunds'],
      selected.scans.purchases,
      'purchases',
      1,
    ],
  });
  const last = await claim();
  await apply({
    kind: 'failure',
    claimId: token(last),
    work: cleanupWork(last)!,
    retryAt: new Date(Date.parse(await now()) + 500).toISOString(),
  });
  const repeated = await read();
  assert({
    given: 'another failure after other lanes positively finish',
    should:
      'keep the only owed resource, count one more failure and never acknowledge',
    actual: [
      repeated.status,
      repeated.attempts,
      repeated.billing_cleanup.turn,
      repeated.billing_cleanup.scans.purchases,
    ],
    expected: ['pending', 2, 'purchases', selected.scans.purchases],
  });
  await rotate();
}
