/** Inspect only the mounted current tree; absence is a readiness precondition. */
export function committedRefusalState(
  element: object,
  requireSettlement: boolean | 'private-owner' = false,
) {
  const diagnostic = {
    settlementRequested: requireSettlement !== false,
    attachedFiber: false,
    currentRoot: false,
    currentNode: false,
    ownerProps: false,
    routerMemo: false,
    routerDependencies: false,
    contextualRouter: false,
    queuePresent: false,
    queueDispatchNull: false,
    queueReducer: false,
    transitionStart: false,
    ownerRefMounted: false,
    rootDepthLimited: false,
    traversalLimited: false,
    ancestorCycleDetected: false,
    currentTreeCycleDetected: false,
    hostRootFound: false,
    transitionCategory: 'unobserved' as
      | 'unobserved'
      | 'false'
      | 'true'
      | 'fulfilled-false'
      | 'fulfilled-other'
      | 'pending-thenable'
      | 'rejected-thenable'
      | 'unsupported',
  };
  type Reason =
    | 'attached-fiber-missing'
    | 'current-root-unavailable'
    | 'current-node-unavailable'
    | 'recovery-owner-unavailable'
    | 'router-memo-unsupported'
    | 'router-dependencies-unsupported'
    | 'contextual-router-unsupported'
    | 'transition-queue-unsupported'
    | 'transition-start-unsupported'
    | 'owner-ref-unmounted'
    | 'transition-not-settled'
    | 'current-owner'
    | 'settled';
  let privateOwner: {
    readonly router: object;
    readonly refresh: unknown;
    readonly recovery: unknown;
    readonly ownerRef: unknown;
    readonly startTransition: unknown;
  } | null = null;
  const result = (requestId: string | null, reason: Reason) => ({
    requestId,
    diagnostic: { ...diagnostic, reason },
    ...(requireSettlement === 'private-owner' ? { privateOwner } : {}),
  });
  type Hook = {
    readonly memoizedState?: unknown;
    readonly queue?: {
      readonly dispatch?: unknown;
      readonly lastRenderedReducer?: unknown;
    };
    readonly next?: Hook | null;
  };
  // Next16.4.2 useRouter's memo precedes React19's two transition hooks.
  // Validate that exact layout; a later exhausted=false is not settlement.
  const settled = (hook: Hook | undefined): Reason => {
    const memo = hook?.memoizedState;
    if (!Array.isArray(memo) || memo.length !== 2)
      return 'router-memo-unsupported';
    diagnostic.routerMemo = true;
    const [router, dependencies] = memo as [unknown, unknown];
    if (!Array.isArray(dependencies) || dependencies.length !== 2)
      return 'router-dependencies-unsupported';
    diagnostic.routerDependencies = true;
    const [original, cache] = dependencies as [unknown, unknown];
    if (
      !router ||
      typeof router !== 'object' ||
      !original ||
      typeof original !== 'object'
    )
      return 'contextual-router-unsupported';
    const contextual = router as { refresh?: unknown; bfcacheId?: unknown };
    if (
      typeof contextual.refresh !== 'function' ||
      contextual.refresh !== (original as { refresh?: unknown }).refresh ||
      typeof cache !== 'number' ||
      !Number.isInteger(cache) ||
      cache < 0 ||
      contextual.bfcacheId !== `_b_${cache}_`
    )
      return 'contextual-router-unsupported';
    diagnostic.contextualRouter = true;
    const transition = hook?.next;
    const start = transition?.next;
    const owner = start?.next?.memoizedState as
      { current?: { stop?: unknown; refused?: unknown } } | undefined;
    diagnostic.queuePresent = transition?.queue != null;
    diagnostic.queueDispatchNull = transition?.queue?.dispatch === null;
    diagnostic.queueReducer =
      typeof transition?.queue?.lastRenderedReducer === 'function';
    if (
      !diagnostic.queuePresent ||
      !diagnostic.queueDispatchNull ||
      !diagnostic.queueReducer
    )
      return 'transition-queue-unsupported';
    diagnostic.transitionStart = typeof start?.memoizedState === 'function';
    if (!diagnostic.transitionStart) return 'transition-start-unsupported';
    diagnostic.ownerRefMounted =
      typeof owner?.current?.stop === 'function' &&
      typeof owner.current.refused === 'function';
    if (!diagnostic.ownerRefMounted) return 'owner-ref-unmounted';
    if (requireSettlement === 'private-owner') {
      privateOwner = {
        router,
        refresh: contextual.refresh,
        recovery: owner!.current,
        ownerRef: owner,
        startTransition: start!.memoizedState,
      };
    }
    const state = transition!.memoizedState;
    if (state === false) diagnostic.transitionCategory = 'false';
    else if (state === true) diagnostic.transitionCategory = 'true';
    else if (
      state !== null &&
      typeof state === 'object' &&
      typeof (state as { then?: unknown }).then === 'function'
    ) {
      const thenable = state as { status?: unknown; value?: unknown };
      diagnostic.transitionCategory =
        thenable.status === 'fulfilled'
          ? thenable.value === false
            ? 'fulfilled-false'
            : 'fulfilled-other'
          : thenable.status === 'pending'
            ? 'pending-thenable'
            : thenable.status === 'rejected'
              ? 'rejected-thenable'
              : 'unsupported';
    } else diagnostic.transitionCategory = 'unsupported';
    return diagnostic.transitionCategory === 'false' ||
      diagnostic.transitionCategory === 'fulfilled-false'
      ? 'settled'
      : 'transition-not-settled';
  };
  type Fiber = {
    readonly tag?: number;
    readonly memoizedState?: Hook;
    readonly memoizedProps?: {
      readonly requestId?: unknown;
      readonly retryAfterMs?: unknown;
    };
    readonly return?: Fiber | null;
    readonly child?: Fiber | null;
    readonly sibling?: Fiber | null;
    readonly stateNode?: unknown;
  };
  const key = Object.keys(element).find((name) =>
    name.startsWith('__reactFiber$'),
  );
  let root =
    key === undefined
      ? undefined
      : (element as unknown as Record<string, Fiber>)[key];
  diagnostic.attachedFiber = key !== undefined;
  if (!diagnostic.attachedFiber) return result(null, 'attached-fiber-missing');
  let remainingWork = 20000;
  const ancestorSeen = new Set<Fiber>();
  while (root && remainingWork > 0) {
    if (ancestorSeen.has(root)) {
      diagnostic.ancestorCycleDetected = true;
      return result(null, 'current-root-unavailable');
    }
    ancestorSeen.add(root);
    remainingWork -= 1;
    if (root.tag === 3) break;
    root = root.return ?? undefined;
  }
  diagnostic.hostRootFound = root?.tag === 3 && root.return == null;
  diagnostic.rootDepthLimited =
    !diagnostic.hostRootFound && remainingWork === 0;
  if (!diagnostic.hostRootFound)
    return result(null, 'current-root-unavailable');
  const holder = root!.stateNode as { readonly current?: Fiber } | undefined;
  const current = holder?.current;
  if (
    current?.tag !== 3 ||
    current.return != null ||
    current.stateNode !== holder
  )
    return result(null, 'current-root-unavailable');
  diagnostic.currentRoot = true;
  // Stage-local sets allow the HostRoot to be visited once in each stage,
  // while one shared budget bounds all ancestry/current-tree work.
  type Path = { readonly fiber: Fiber; readonly parent: Path | null };
  const pending: { fiber: Fiber; path: Path | null }[] = [
    { fiber: current, path: null },
  ];
  const currentSeen = new Set<Fiber>();
  let found: Path | null = null;
  while (pending.length > 0 && remainingWork > 0) {
    const { fiber, path } = pending.pop()!;
    remainingWork -= 1;
    if (currentSeen.has(fiber)) {
      diagnostic.currentTreeCycleDetected = true;
      return result(null, 'current-node-unavailable');
    }
    currentSeen.add(fiber);
    const currentPath: Path = { fiber, parent: path };
    if (fiber.stateNode === element) {
      diagnostic.currentNode = true;
      found = currentPath;
    }
    if (fiber.sibling) pending.push({ fiber: fiber.sibling, path });
    if (fiber.child) pending.push({ fiber: fiber.child, path: currentPath });
  }
  diagnostic.traversalLimited = pending.length > 0;
  if (diagnostic.traversalLimited || !found)
    return result(null, 'current-node-unavailable');
  // Validate the complete bounded current tree before trusting the found path.
  for (
    let path: Path | null = found;
    path && remainingWork > 0;
    path = path.parent
  ) {
    remainingWork -= 1;
    const ancestor = path.fiber;
    const props = ancestor.memoizedProps;
    if (
      typeof props?.requestId === 'string' &&
      /^[a-z0-9]{24}$/.test(props.requestId) &&
      typeof props.retryAfterMs === 'number'
    ) {
      diagnostic.ownerProps = true;
      if (!requireSettlement) return result(props.requestId, 'current-owner');
      const reason = settled(ancestor.memoizedState);
      return result(reason === 'settled' ? props.requestId : null, reason);
    }
  }
  diagnostic.traversalLimited = remainingWork === 0;
  return result(null, 'recovery-owner-unavailable');
}
