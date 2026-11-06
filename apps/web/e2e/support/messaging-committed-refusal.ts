/** Inspect only the mounted current tree; absence is a readiness precondition. */
export function committedRefusalRenderId(element: object): string | null {
  type Fiber = {
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
          return props.requestId;
      }
      return null;
    }
    if (fiber.sibling) pending.push({ fiber: fiber.sibling, path });
    if (fiber.child)
      pending.push({ fiber: fiber.child, path: [...path, fiber] });
  }
  return null;
}
