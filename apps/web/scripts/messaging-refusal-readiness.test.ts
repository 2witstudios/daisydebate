import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedRefusalState } from '../e2e/support/messaging-committed-refusal';
setupRitewayBun();
const hostRoot = (child: unknown) => {
  type Root = { tag: number; stateNode: { current: Root }; child: unknown };
  const state = { current: null as unknown as Root };
  const select = (next: unknown) => {
    state.current = { tag: 3, stateNode: state, child: next };
  };
  select(child);
  return { host: state.current, select };
};

const mounted = () => {
  const element: Record<string, unknown> = {};
  const refresh = () => {};
  const reference = { current: { stop: () => {}, refused: () => {} } };
  const transition = {
    memoizedState: false as unknown,
    queue: { dispatch: null as unknown, lastRenderedReducer: () => {} },
    next: {
      memoizedState: (() => {}) as unknown,
      next: { memoizedState: reference as unknown },
    },
  };
  const memo = {
    memoizedState: [
      { refresh, bfcacheId: '_b_7_' },
      [{ refresh }, 7],
    ] as unknown,
    next: transition,
  };
  const owner = {
    memoizedProps: { requestId: 'c'.repeat(24), retryAfterMs: 1000 },
    memoizedState: memo,
    child: { stateNode: element },
  };
  const { host, select } = hostRoot(owner);
  element['__reactFiber$fixture'] = { return: host };
  return { element, host, select, owner, memo, transition };
};

test('readiness diagnoses each fixed gate without returning hook or identity data in its projection', () => {
  const sample = mounted();
  const good = committedRefusalState(sample.element, true);
  const reasons = [committedRefusalState({}, true).diagnostic.reason];
  sample.memo.memoizedState = null;
  reasons.push(committedRefusalState(sample.element, true).diagnostic.reason);
  sample.memo.memoizedState = [{ refresh: () => {}, bfcacheId: '_b_7_' }, []];
  reasons.push(committedRefusalState(sample.element, true).diagnostic.reason);
  assert({
    given:
      'a missing DOM attachment and unsupported router memo/dependency shapes',
    should: 'report fixed failure stages without relaxing settlement',
    actual: reasons,
    expected: [
      'attached-fiber-missing',
      'router-memo-unsupported',
      'router-dependencies-unsupported',
    ],
  });
  assert({
    given: 'a valid current settled owner',
    should:
      'keep private correlation separate from a fixed diagnostic projection',
    actual: {
      ready: good.requestId !== null,
      diagnosticHasIdentity: JSON.stringify(good.diagnostic).includes(
        'c'.repeat(24),
      ),
      reason: good.diagnostic.reason,
    },
    expected: { ready: true, diagnosticHasIdentity: false, reason: 'settled' },
  });
});

test('queue/start/ref/pending reasons preserve the existing fail-closed predicates', () => {
  const sample = mounted();
  const values: string[] = [];
  sample.transition.queue.dispatch = () => {};
  values.push(committedRefusalState(sample.element, true).diagnostic.reason);
  sample.transition.queue.dispatch = null;
  sample.transition.next.memoizedState = false;
  values.push(committedRefusalState(sample.element, true).diagnostic.reason);
  sample.transition.next.memoizedState = () => {};
  sample.transition.next.next.memoizedState = { current: null };
  values.push(committedRefusalState(sample.element, true).diagnostic.reason);
  sample.transition.next.next.memoizedState = {
    current: { stop: () => {}, refused: () => {} },
  };
  sample.transition.memoizedState = true;
  const pending = committedRefusalState(sample.element, true);
  values.push(pending.diagnostic.reason);
  assert({
    given:
      'ordinary-state dispatch, wrong start hook, unmounted owner and true transition',
    should: 'distinguish each unsupported gate while rejecting all',
    actual: values,
    expected: [
      'transition-queue-unsupported',
      'transition-start-unsupported',
      'owner-ref-unmounted',
      'transition-not-settled',
    ],
  });
  assert({
    given: 'a true transition in a current mounted owner',
    should:
      'retain pending semantics without treating another false hook as settlement',
    actual: {
      id: pending.requestId,
      category: pending.diagnostic.transitionCategory,
    },
    expected: { id: null, category: 'true' },
  });
});

test('root, exact current node and recovery-owner props failures stay distinct', () => {
  const attached: Record<string, unknown> = { __reactFiber$fixture: {} };
  const missingRoot = committedRefusalState(attached, true).diagnostic.reason;
  const sample = mounted();
  sample.select({ stateNode: {} });
  const missingNode = committedRefusalState(sample.element, true).diagnostic
    .reason;
  sample.select(sample.owner);
  sample.owner.memoizedProps.requestId = 'not-an-id';
  const missingOwner = committedRefusalState(sample.element, true).diagnostic
    .reason;
  assert({
    given:
      'an attached non-root fiber, another current node and an ancestor without recovery props',
    should:
      'distinguish each fail-closed location rather than conflate them with pending transition',
    actual: [missingRoot, missingNode, missingOwner],
    expected: [
      'current-root-unavailable',
      'current-node-unavailable',
      'recovery-owner-unavailable',
    ],
  });
});
