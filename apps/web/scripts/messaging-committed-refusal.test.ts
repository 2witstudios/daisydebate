import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedRefusalState } from '../e2e/support/messaging-committed-refusal';
setupRitewayBun();
const committedRefusalRenderId = (element: object, settled = false) =>
  committedRefusalState(element, settled).requestId;

test('the refusal oracle waits for the exact node in the committed tree', () => {
  const id = 'c'.repeat(24);
  const element: Record<string, unknown> = {};
  const absent = committedRefusalRenderId(element);
  const node = { stateNode: element };
  const owner = {
    memoizedProps: { requestId: id, retryAfterMs: 1000 },
    child: node,
  };
  const committed = { child: owner };
  const host = { stateNode: { current: committed } };
  element['__reactFiber$fixture'] = { return: host };
  const mounted = committedRefusalRenderId(element);
  host.stateNode.current = { child: { ...owner, child: { stateNode: {} } } };
  const unmounted = committedRefusalRenderId(element);
  assert({
    given:
      'server paint, then a committed mount, then a different committed node',
    should:
      'read the current ancestor identity only while this exact node is mounted',
    actual: [absent, mounted, unmounted],
    expected: [null, id, null],
  });
});

test('an alternate render cannot satisfy committed identity', () => {
  const currentId = 'c'.repeat(24);
  const futureId = 'f'.repeat(24);
  const element: Record<string, unknown> = {};
  const current = {
    memoizedProps: { requestId: currentId, retryAfterMs: 1000 },
    child: { stateNode: element },
  };
  const future = {
    memoizedProps: { requestId: futureId, retryAfterMs: 1000 },
    child: { stateNode: element },
  };
  const host = { stateNode: { current: { child: current } } };
  element['__reactFiber$fixture'] = { return: host, alternate: future };
  const uncommitted = committedRefusalRenderId(element);
  host.stateNode.current = { child: future };
  const committed = committedRefusalRenderId(element);
  assert({
    given:
      'an attached alternate carries a newer identity before root.current changes',
    should: 'ignore that identity until the actual committed root selects it',
    actual: [uncommitted, committed],
    expected: [currentId, futureId],
  });
});

test('settlement follows the installed router memo then transition hooks, never any false state', () => {
  const id = 'c'.repeat(24);
  const element: Record<string, unknown> = {};
  const refresh = () => {};
  const router = { refresh };
  const transition: { memoizedState: unknown; queue: unknown; next: unknown } =
    {
      memoizedState: true,
      queue: { dispatch: null, lastRenderedReducer: () => {} },
      next: {
        memoizedState: () => {},
        next: {
          memoizedState: { current: { stop: () => {}, refused: () => {} } },
          next: { memoizedState: false },
        },
      },
    };
  const owner = {
    memoizedProps: { requestId: id, retryAfterMs: 1000 },
    memoizedState: {
      memoizedState: [{ refresh, bfcacheId: '_b_7_' }, [router, 7]] as unknown,
      next: transition,
    },
    child: { stateNode: element },
  };
  const host = { stateNode: { current: { child: owner } } };
  element['__reactFiber$fixture'] = { return: host };
  const samples = [
    true,
    false,
    { status: 'pending', then: () => {} },
    { status: 'fulfilled', value: false, then: () => {} },
    { status: 'fulfilled', value: true, then: () => {} },
    { status: 'rejected', then: () => {} },
    {},
  ].map((state) => {
    transition.memoizedState = state;
    return committedRefusalRenderId(element, true);
  });
  assert({
    given:
      'the installed router memo precedes a pending/settled transition and an unrelated exhausted=false hook',
    should:
      'accept only this committed transition false or its fulfilled-false thenable',
    actual: samples,
    expected: [null, id, null, id, null, null, null],
  });
  transition.memoizedState = false;
  const validQueue = transition.queue;
  transition.queue = { dispatch: () => {}, lastRenderedReducer: () => {} };
  const wrongStateQueue = committedRefusalRenderId(element, true);
  transition.queue = validQueue;
  assert({
    given:
      'an ordinary state hook queue has a dispatch function rather than the installed transition null dispatch',
    should:
      'reject the wrong hook instead of certifying an unrelated false state',
    actual: wrongStateQueue,
    expected: null,
  });
  const validMemo = owner.memoizedState.memoizedState;
  const future = {
    ...owner,
    memoizedProps: { requestId: 'f'.repeat(24), retryAfterMs: 1000 },
    memoizedState: {
      ...owner.memoizedState,
      next: { ...transition, memoizedState: false },
    },
  };
  transition.memoizedState = true;
  element['__reactFiber$fixture'] = { return: host, alternate: future };
  const pendingCurrent = committedRefusalRenderId(element, true);
  transition.memoizedState = false;
  host.stateNode.current = { child: future };
  const committedFuture = committedRefusalRenderId(element, true);
  assert({
    given: 'the attached alternate is distinct from the current pending owner',
    should:
      'read only the current branch and accept the newer owner after actual commit and settlement',
    actual: [pendingCurrent, committedFuture],
    expected: [null, 'f'.repeat(24)],
  });
  host.stateNode.current = { child: owner };
  owner.memoizedState.memoizedState = [false, []];
  assert({
    given:
      'a false state exists but the router/transition hook layout is unknown',
    should: 'reject shape drift rather than scan for a convenient false',
    actual: committedRefusalRenderId(element, true),
    expected: null,
  });
  owner.memoizedState.memoizedState = validMemo;
  transition.next = { memoizedState: false };
  assert({
    given: 'a later false hook lacks the transition start callback',
    should: 'reject the wrong hook position',
    actual: committedRefusalRenderId(element, true),
    expected: null,
  });
});
