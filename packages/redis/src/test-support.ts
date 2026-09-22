import { createRedis } from './index';

type RecordedCommand = { command: string; args: string[] };

/**
 * Stands in for the Redis wire protocol only: records issued commands and
 * returns scripted values, so the adapter's namespacing, TTL and failure
 * semantics are exercised without a live server.
 */
function fakeRedis(values: Map<string, string> = new Map()) {
  const commands: RecordedCommand[] = [];
  let closed = false;
  let scriptedEval: unknown = [1, 60000];
  const client = {
    async connect() {
      if (closed) throw new Error('client closed');
    },
    async ping() {
      commands.push({ command: 'PING', args: [] });
      return 'PONG';
    },
    async send(command: string, args: string[]) {
      commands.push({ command, args });
      if (command === 'SET') values.set(args[0] ?? '', args[1] ?? '');
      if (command === 'EVAL') return scriptedEval;
      return 'OK';
    },
    async get(key: string) {
      commands.push({ command: 'GET', args: [key] });
      return values.get(key) ?? null;
    },
    async del(key: string) {
      commands.push({ command: 'DEL', args: [key] });
      return values.delete(key) ? 1 : 0;
    },
    close() {
      closed = true;
    },
  };
  return {
    client: client as never,
    scriptEval: (value: unknown) => {
      scriptedEval = value;
    },
    commands,
    values: () => values,
    isClosed: () => closed,
  };
}

export const createTestRedis = (
  events: Array<{
    event: string;
    fields: Record<string, unknown>;
    message: string;
  }> = [],
  values?: Map<string, string>,
) => {
  const fake = fakeRedis(values);
  const redis = createRedis({
    url: 'redis://127.0.0.1:1',
    namespace: 'test',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    client: fake.client,
  });
  return { redis, ...fake };
};
