import type { TenantScope } from './tenant-scope';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

export type BoundedTransactionContext = Pick<
  BunSQLDatabase,
  | 'select'
  | 'selectDistinct'
  | 'selectDistinctOn'
  | 'insert'
  | 'update'
  | 'delete'
  | 'execute'
>;

// Identity stays internal to the adapter; callers cannot forge a bounded context
// by supplying a structurally similar execute method.
const boundedContexts = new WeakSet<object>();
const tenantScopeOwners = new WeakMap<
  object,
  (scope: TenantScope) => Promise<void>
>();

/** Only the adapter may register a tenant scope owner for its opaque live context. */
export async function scopeBoundedTransaction(
  context: object,
  scope: TenantScope,
): Promise<boolean> {
  const owner = tenantScopeOwners.get(context);
  if (!owner) return false;
  await owner(scope);
  return true;
}

export const isBoundedTransactionContext = (value: object): boolean =>
  boundedContexts.has(value);

/** Expose only the actual DML surface; never a raw client or nested transaction API. */
export function transactionContext(
  database: BunSQLDatabase,
  check: () => void,
  refuse: (message: string) => never,
  scopeTenant?: (scope: TenantScope) => Promise<void>,
): BoundedTransactionContext {
  const methods: BoundedTransactionContext = {
    select: database.select.bind(database),
    selectDistinct: database.selectDistinct.bind(database),
    selectDistinctOn: database.selectDistinctOn.bind(database),
    insert: database.insert.bind(database),
    update: database.update.bind(database),
    delete: database.delete.bind(database),
    execute: database.execute.bind(database),
  };
  const context = new Proxy(Object.freeze(methods), {
    get(target, property, receiver) {
      check();
      if (!Object.hasOwn(target, property))
        refuse('Transaction controls are adapter-owned');
      return Reflect.get(target, property, receiver);
    },
  });
  boundedContexts.add(context);
  if (scopeTenant) tenantScopeOwners.set(context, scopeTenant);
  return context;
}
