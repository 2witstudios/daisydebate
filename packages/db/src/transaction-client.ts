import type { ReservedSQL } from 'bun';

/**
 * Bun1.4.2 unsafe(text, []) selects simple protocol (Query+Flush). The trailing
 * Flush disarms PostgreSQL's idle timer after ReadyForQuery. Use the same native
 * reserved connection's prepared/tagged path (Parse/Bind/Execute/Flush/Sync) for
 * parameterless Drizzle statements so the server re-arms its idle backstop.
 */
export function synchronizedTransactionClient(
  client: ReservedSQL,
  signal: AbortSignal,
): ReservedSQL {
  return new Proxy(client, {
    apply(target, receiver, parameters) {
      signal.throwIfAborted();
      return Reflect.apply(target, receiver, parameters);
    },
    get(target, property) {
      if (property !== 'unsafe') return Reflect.get(target, property);
      return (text: string, parameters: unknown[] = []) => {
        signal.throwIfAborted();
        if (parameters.length > 0) return target.unsafe(text, parameters);
        const literal = Object.assign([text], { raw: [text] });
        return target(literal as unknown as TemplateStringsArray);
      };
    },
  });
}
