import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { virtualClock } from '@daisy/clock/testing';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../src/features/messaging/beta-policy';
import { createApp } from '../src/server/app';
import {
  TABLE,
  renderTable,
  routeFiles,
  routeModule,
  routeTable,
  servedPath,
} from './route-table';

setupRitewayBun();

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

type Bound = { readonly bindTo: (app: unknown) => unknown };
const isBound = (value: unknown): value is Bound =>
  typeof value === 'function' &&
  typeof (value as Partial<Bound>).bindTo === 'function';

test('every route module keeps its path, methods and segment config', async () => {
  assert({
    given: 'the route modules under src/app',
    should:
      'match route-table.json (`bun run scripts/route-table.ts` rewrites it)',
    actual: renderTable(await routeTable()),
    expected: await Bun.file(TABLE).text(),
  });
});

test('every bound handler resolves on an app of the test’s own', async () => {
  const app = createApp({
    waits: virtualClock(),
    messagingPolicy: betaMessagingPolicy,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'unit-route-net',
      LOG_LEVEL: 'silent',
      ...authTestEnv,
    },
    fetch: async () => new Response(null, { status: 599 }),
    clock: fixedClock('2026-11-23T00:00:00.000Z'),
    ids: sequentialId('route-net'),
  });
  const unresolved: string[] = [];
  let bound = 0;
  for (const file of routeFiles()) {
    const module = await routeModule(file);
    for (const method of METHODS) {
      const handler = module[method];
      if (!isBound(handler)) continue;
      bound++;
      if (typeof handler.bindTo(app) !== 'function')
        unresolved.push(`${method} ${servedPath(file)}`);
    }
  }
  await app.close();
  assert({
    given: 'each method a route module binds through processRoute',
    should: 'select a handler that exists',
    actual: { unresolved, someBound: bound > 200 },
    expected: { unresolved: [], someBound: true },
  });
});
