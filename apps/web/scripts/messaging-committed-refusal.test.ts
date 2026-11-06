import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedRefusalRenderId } from '../e2e/support/messaging-committed-refusal';
setupRitewayBun();

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
