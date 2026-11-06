import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedRefusalState } from '../e2e/support/messaging-committed-refusal';
setupRitewayBun();

type Fiber = {
  tag?: number;
  stateNode?: unknown;
  memoizedProps?: { requestId: string; retryAfterMs: number };
  return?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
};
const tree = (depth = 0, element: Record<string, unknown> = {}) => {
  const node: Fiber = { stateNode: element };
  const owner: Fiber = {
    memoizedProps: { requestId: 'c'.repeat(24), retryAfterMs: 1000 },
    child: node,
  };
  node.return = owner;
  let top = owner;
  for (let n = 0; n < depth; n++) {
    const parent: Fiber = { child: top };
    top.return = parent;
    top = parent;
  }
  const state = { current: null as Fiber | null };
  const host: Fiber = { tag: 3, stateNode: state, child: top };
  top.return = host;
  state.current = host;
  element['__reactFiber$fixture'] = node;
  return { element, node, owner, host, state };
};

test('a legitimate current HostRoot beyond100 parents remains discoverable under the total bound', () => {
  const sample = tree(150);
  assert({
    given: 'an acyclic mounted tree with more than100 attached-fiber ancestors',
    should:
      'select actual HostRoot.current and its exact mounted owner instead of assuming a shallow root',
    actual: committedRefusalState(sample.element).requestId !== null,
    expected: true,
  });
});

test('ancestor and current child/sibling cycles fail closed', () => {
  const ancestor = tree();
  ancestor.node.return = ancestor.node;
  const child = tree();
  const loop: Fiber = {};
  loop.child = loop;
  child.owner.sibling = loop;
  const sibling = tree();
  sibling.owner.sibling = sibling.owner;
  assert({
    given:
      'a return cycle and child/sibling cycles even beside the exact known node',
    should:
      'reject malformed traversals without accepting a convenient mounted node',
    actual: [ancestor, child, sibling].map((sample) => {
      const observed = committedRefusalState(sample.element);
      return {
        id: observed.requestId,
        ancestorCycle: observed.diagnostic.ancestorCycleDetected,
        currentCycle: observed.diagnostic.currentTreeCycleDetected,
      };
    }),
    expected: [
      { id: null, ancestorCycle: true, currentCycle: false },
      { id: null, ancestorCycle: false, currentCycle: true },
      { id: null, ancestorCycle: false, currentCycle: true },
    ],
  });
});

test('only a real tag3 root with its own valid current branch may establish ownership', () => {
  const fake = tree();
  fake.host.tag = 0;
  const unrelated = tree();
  const other = tree(0, unrelated.element);
  unrelated.element['__reactFiber$fixture'] = unrelated.node;
  unrelated.state.current = other.host;
  const nestedRoot = tree();
  nestedRoot.host.return = {};
  const unsupported = tree();
  unsupported.state.current = { tag: 3, child: unsupported.owner };
  assert({
    given:
      'a nonHostRoot with a current-shaped object, a different root current and an unsupported root state',
    should:
      'reject each rather than infer current ownership from a property name',
    actual: [fake, unrelated, nestedRoot, unsupported].map(
      (sample) => committedRefusalState(sample.element).requestId,
    ),
    expected: [null, null, null, null],
  });
});

test('ancestor discovery and current-tree traversal share one20k ceiling', () => {
  const sample = tree(11000);
  const result = committedRefusalState(sample.element);
  assert({
    given:
      'each traversal would fit20k separately but their combined work exceeds it',
    should: 'fail closed under the single total ceiling',
    actual: {
      id: result.requestId,
      currentRoot: result.diagnostic.currentRoot,
      limited: result.diagnostic.traversalLimited,
    },
    expected: { id: null, currentRoot: true, limited: true },
  });
});
