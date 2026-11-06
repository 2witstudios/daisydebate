/** Installed Flight sends the client reference and props, not its rendered status. */
export function hasAdvisedConversationBoundary(payload: string): boolean {
  const references = new Set<string>();
  const models: unknown[] = [];
  for (const row of payload.split('\n')) {
    const match = /^([a-f0-9]+):(I?)(.*)$/.exec(row);
    if (!match) continue;
    try {
      const value: unknown = JSON.parse(match[3]!);
      if (match[2] === 'I') {
        if (Array.isArray(value) && value[2] === 'ConversationReconnecting')
          references.add(`$L${match[1]}`);
      } else models.push(value);
    } catch {
      // Binary, hint and error rows are not the recovery client boundary.
    }
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
          return true;
      }
      pending.push(...value);
    } else if (value !== null && typeof value === 'object')
      pending.push(...Object.values(value));
  }
  return false;
}
