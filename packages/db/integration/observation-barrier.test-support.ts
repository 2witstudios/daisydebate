import type { SQL } from 'bun';
/** Pause only after real SQL settles; the test chooses exact discovery/fence/header interleavings. */
export function observationBarrierClient(
  client: SQL,
  after: (statement: string) => Promise<void>,
  onTransaction: () => void,
): SQL {
  const queries = new WeakMap<object, object>();
  const wrapQuery = (query: object, statement: string): object => {
    const previous = queries.get(query);
    if (previous) return previous;
    const finish = async (result: unknown) => {
      await after(statement);
      return result;
    };
    const proxy = {
      then(
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) {
        return Promise.resolve(query).then(finish).then(resolve, reject);
      },
      catch(reject: (error: unknown) => unknown) {
        return Promise.resolve(query).then(finish).catch(reject);
      },
      finally(settle: () => void) {
        return Promise.resolve(query).then(finish).finally(settle);
      },
      values() {
        return Promise.resolve(
          Reflect.apply(Reflect.get(query, 'values'), query, []),
        ).then(finish);
      },
    };
    queries.set(query, proxy);
    queries.set(proxy, proxy);
    return proxy;
  };
  const wrapClient = (connection: SQL): SQL =>
    new Proxy(connection, {
      apply(target, receiver, args) {
        const statement = Array.isArray(args[0])
          ? args[0].join('?')
          : String(args[0]);
        return wrapQuery(Reflect.apply(target, receiver, args), statement);
      },
      get(target, key) {
        if (key === 'begin')
          return (work: (tx: SQL) => Promise<unknown>) => {
            onTransaction();
            return target.begin((tx) => work(wrapClient(tx)));
          };
        if (key === 'unsafe')
          return (statement: string, params: unknown[]) =>
            wrapQuery(target.unsafe(statement, params), statement);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return wrapClient(client);
}
export const observationBarrier = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
