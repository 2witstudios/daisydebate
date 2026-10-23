import { createBoundedTransaction } from './bounded-transaction';
import { fakeSql, type ScriptedProtocol } from './scripted-bun-wire';

/**
 * Wrapper control flow only: the scripted wire answers the adapter's own
 * protocol statements. Real PostgreSQL budgets, locks and rollback are proven
 * by the bounded-transaction integration suites.
 */
export const bounded = (
  options: {
    readonly script?: Parameters<typeof fakeSql>[0];
    readonly protocol?: ScriptedProtocol;
    readonly maxConnections?: number;
    readonly now?: () => number;
  } = {},
) => {
  const wire = fakeSql(options.script ?? [], options.protocol);
  const run = createBoundedTransaction({
    client: wire.client,
    maxConnections: options.maxConnections ?? 4,
    now: options.now ?? (() => 0),
  });
  return { ...wire, run };
};

export const causeOf = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return undefined;
  } catch (error) {
    const { message, cause } = error as Error & { cause?: unknown };
    return { message, cause };
  }
};
