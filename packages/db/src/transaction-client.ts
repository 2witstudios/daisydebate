import type { ReservedSQL, SQL } from 'bun';
import { assertTransactionStatement } from './transaction-statement';

type CheckLifetime = () => void;

/** Fence lazy native execution as well as construction and query modifiers. */
function lifetimeQuery<T>(
  query: SQL.Query<T>,
  check: CheckLifetime,
  refuse: (message: string) => never,
): SQL.Query<T> {
  const guarded = new Proxy(query, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (typeof member !== 'function') return member;
      return (...parameters: unknown[]) => {
        check();
        if (property === 'simple')
          refuse('Bounded queries require prepared protocol');
        const result = Reflect.apply(member, target, parameters);
        return result === target ? guarded : result;
      };
    },
  });
  return guarded;
}

/**
 * Bun1.4.2 unsafe(text, []) selects Query+Flush, whose trailing Flush disarms
 * PostgreSQL's idle timer. Keep the SAME reservation on prepared protocol ending
 * Sync; bind parameters natively, and refuse callback-owned transaction controls.
 */
export function synchronizedTransactionClient(
  client: ReservedSQL,
  check: CheckLifetime,
  refuse: (message: string) => never,
): ReservedSQL {
  client.options.bigint = true;
  const options = { bigint: true };
  return new Proxy(client, {
    apply(target, receiver, parameters) {
      check();
      const [strings] = parameters;
      const text =
        typeof strings === 'string' ? strings : strings.join('$parameter');
      assertTransactionStatement(text, refuse);
      return lifetimeQuery(
        Reflect.apply(target, receiver, parameters),
        check,
        refuse,
      );
    },
    get(target, property) {
      if (property === 'options') return options;
      if (property !== 'unsafe')
        refuse('Raw transaction controls are adapter-owned');
      return (text: string, parameters: unknown[] = []) => {
        check();
        assertTransactionStatement(text, refuse);
        const literal = Object.assign([text], { raw: [text] });
        const query =
          parameters.length > 0
            ? target.unsafe(text, parameters)
            : target(literal as unknown as TemplateStringsArray);
        return lifetimeQuery(query, check, refuse);
      };
    },
  });
}
