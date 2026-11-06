/** Installed Flight sends the client reference and props, not its rendered status. */
export function advisedConversationBoundary(
  payload: string,
): { requestId: string; retryAfterMs: number } | null {
  const references = new Set<string>();
  const models: unknown[] = [];
  const rows = new Map<string, unknown>();
  const imports: { id: string; value: unknown }[] = [];
  for (const row of payload.split('\n')) {
    const match = /^([a-f0-9]+):(I?)(.*)$/.exec(row);
    if (!match) continue;
    try {
      const value: unknown = JSON.parse(match[3]!);
      rows.set(match[1]!, value);
      if (match[2] === 'I') imports.push({ id: match[1]!, value });
      else models.push(value);
    } catch {
      // Binary, hint and error rows are not the recovery client boundary.
    }
  }
  for (const { id, value } of imports) {
    if (!Array.isArray(value)) continue;
    const name: unknown = value[2];
    // The installed serializer can outline this string. Resolve exactly one
    // string row, never an alias chain or another element's advice.
    const exported =
      typeof name === 'string' && /^\$[a-f0-9]+$/.test(name)
        ? rows.get(name.slice(1))
        : name;
    if (exported === 'ConversationReconnecting') references.add(`$L${id}`);
  }
  const pending = [...models];
  for (let visited = 0; pending.length > 0 && visited < 20000; visited += 1) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      const props: unknown = value[3];
      if (
        value[0] === '$' &&
        references.has(value[1]) &&
        props !== null &&
        typeof props === 'object'
      ) {
        const { requestId, retryAfterMs } = props as Record<string, unknown>;
        if (
          typeof requestId === 'string' &&
          /^[a-z0-9]{24}$/.test(requestId) &&
          typeof retryAfterMs === 'number' &&
          Number.isInteger(retryAfterMs) &&
          retryAfterMs >= 1000 &&
          retryAfterMs <= 10000
        )
          return { requestId, retryAfterMs };
      }
      pending.push(...value);
    } else if (value !== null && typeof value === 'object')
      pending.push(...Object.values(value));
  }
  return null;
}

export const hasAdvisedConversationBoundary = (payload: string): boolean =>
  advisedConversationBoundary(payload) !== null;
