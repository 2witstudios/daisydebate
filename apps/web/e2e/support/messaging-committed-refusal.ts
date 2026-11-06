/** Inspect only the mounted current tree; absence is a readiness precondition. */
export function committedRefusalRenderId(
  element: object,
  requireSettlement = false,
): string | null {
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
  const settled = (hook: Hook | undefined) => {
    const memo = hook?.memoizedState;
    if (!Array.isArray(memo) || memo.length !== 2) return false;
    const [router, dependencies] = memo as [unknown, unknown];
    if (!Array.isArray(dependencies) || dependencies.length !== 2) return false;
    const [original, cache] = dependencies as [unknown, unknown];
    if (
      !router ||
      typeof router !== 'object' ||
      !original ||
      typeof original !== 'object'
    )
      return false;
    const contextual = router as { refresh?: unknown; bfcacheId?: unknown };
    if (
      typeof contextual.refresh !== 'function' ||
      contextual.refresh !== (original as { refresh?: unknown }).refresh ||
      typeof cache !== 'number' ||
      !Number.isInteger(cache) ||
      cache < 0 ||
      contextual.bfcacheId !== `_b_${cache}_`
    )
      return false;
    const transition = hook?.next;
    const start = transition?.next;
    const owner = start?.next?.memoizedState as
      { current?: { stop?: unknown; refused?: unknown } } | undefined;
    if (
      !transition?.queue ||
      transition.queue.dispatch !== null ||
      typeof transition.queue.lastRenderedReducer !== 'function' ||
      typeof start?.memoizedState !== 'function' ||
      typeof owner?.current?.stop !== 'function' ||
      typeof owner.current.refused !== 'function'
    )
      return false;
    const state = transition.memoizedState;
    return (
      state === false ||
      (state !== null &&
        typeof state === 'object' &&
        typeof (state as { then?: unknown }).then === 'function' &&
        (state as { status?: unknown }).status === 'fulfilled' &&
        (state as { value?: unknown }).value === false)
    );
  };
  type Fiber = {
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
  for (let depth = 0; root?.return && depth < 100; depth += 1)
    root = root.return;
  const current = (root?.stateNode as { readonly current?: Fiber } | undefined)
    ?.current;
  if (!current) return null;
  const pending: { fiber: Fiber; path: readonly Fiber[] }[] = [
    { fiber: current, path: [] },
  ];
  for (let visited = 0; pending.length > 0 && visited < 20000; visited += 1) {
    const { fiber, path } = pending.pop()!;
    if (fiber.stateNode === element) {
      for (const ancestor of [...path, fiber].reverse()) {
        const props = ancestor.memoizedProps;
        if (
          typeof props?.requestId === 'string' &&
          /^[a-z0-9]{24}$/.test(props.requestId) &&
          typeof props.retryAfterMs === 'number'
        )
          return !requireSettlement || settled(ancestor.memoizedState)
            ? props.requestId
            : null;
      }
      return null;
    }
    if (fiber.sibling) pending.push({ fiber: fiber.sibling, path });
    if (fiber.child)
      pending.push({ fiber: fiber.child, path: [...path, fiber] });
  }
  return null;
}
