import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

export type BoundedTransactionContext = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/** Expose only the actual DML surface; never a raw client or nested transaction API. */
export function transactionContext(
  database: BunSQLDatabase,
  check: () => void,
  refuse: (message: string) => never,
): BoundedTransactionContext {
  const methods: BoundedTransactionContext = {
    select: database.select.bind(database),
    insert: database.insert.bind(database),
    update: database.update.bind(database),
    delete: database.delete.bind(database),
    execute: database.execute.bind(database),
  };
  return new Proxy(Object.freeze(methods), {
    get(target, property, receiver) {
      check();
      if (!Object.hasOwn(target, property))
        refuse('Transaction controls are adapter-owned');
      return Reflect.get(target, property, receiver);
    },
  });
}
