import { assert, describe, test } from 'riteway/bun';
import {
  expectedOf,
  outcomes,
  web,
  props,
  globals,
  imports,
  edgeImport,
  reads,
  mutations,
  sixMutations,
  route,
  lazyEdge,
  e2eServer,
  escapes,
  escapeRule,
  type Case,
  launchEntryCases,
} from './eslint.config.test-support';

const hostTime = 'daisy-time/host-time';

export function registerProcessEdgeTests() {
  describe('process edge: one module reads process.env and globalThis (ISSUE-7)', () => {
    test('rejects ambient reads and edge imports outside the edge', async () => {
      const cases: Case[] = [
        ['export const f = process.env.X;', web('proxy.ts'), props],
        [
          'const { env } = process;\nexport const e = env;',
          web('lib/x.ts'),
          props,
        ],
        [
          'export const level = Bun.env.X;',
          'apps/realtime/src/server.ts',
          props,
        ],
        // The host object handed out whole also reaches its timers (ADR 0915).
        [
          "export const a = Reflect.get(globalThis, 'a');",
          route,
          [...globals, hostTime],
        ],
        [
          'export const a = globalThis as unknown;',
          web('lib/clock-display.ts'),
          [...globals, hostTime],
        ],
        [
          edgeImport('../../server/'),
          web('features/foundation/leak.ts'),
          imports,
        ],
        [edgeImport('../server/'), web('lib/clock-display.ts'), imports],
        [edgeImport('../../../../server/'), route, imports],
        [edgeImport('./'), web('server/composition.ts'), imports],
        // A feature's own reads outside its page-reads module stay off the edge.
        [
          edgeImport('../../server/'),
          web('features/tab/reads/league.ts'),
          imports,
        ],
        // A feature's page reads reach the app through the request scope.
        [
          edgeImport('../../server/'),
          web('features/tab/page-reads.ts'),
          imports,
        ],
        [
          edgeImport('../../../server/'),
          web('features/watch/page-reads/live.ts'),
          imports,
        ],
        [
          edgeImport('../../server/'),
          web('server/billing/page-reads.ts'),
          imports,
        ],
        // A page read never binds a route.
        [
          edgeImport('../../server/', 'processRoute'),
          web('features/tab/page-reads.ts'),
          imports,
        ],
        ...escapes.map(([code, file]): Case => [code, file, escapeRule(code)]),
      ];
      assert({
        given:
          'app source reading process.env, Bun.env or globalThis, or importing the process edge as a locator',
        should: 'report each as the matching restriction',
        actual: await outcomes(cases),
        expected: expectedOf(cases),
      });
    });

    test('admits the edges, route bindings and the documented process entries', async () => {
      const cases: Case[] = [
        // A process entry may read the host, but not hand the host object out whole.
        [reads, web('server/process-app.ts'), [hostTime]],
        [reads, 'apps/realtime/src/start.ts', [hostTime]],
        [edgeImport('../../../../server/', 'processRoute'), route, []],
        [edgeImport('./server/'), web('proxy.ts'), []],
        [edgeImport('./server/'), web('instrumentation.ts'), []],
        [edgeImport('./'), web('server/start.ts'), []],
        [edgeImport('../server/'), web('lib/page-reads.ts'), []],
        [lazyEdge('./server/process-app'), web('instrumentation.ts'), []],
        [edgeImport('../../src/server/', 'adoptProcessApp'), e2eServer, []],
        [
          'export const u = process.env.TEST_DATABASE_URL;',
          'apps/web/integration/r.integration.ts',
          [],
        ],
      ];
      assert({
        given:
          'the two edges, a processRoute binding, the process entries and a test reading its service URL',
        should: 'report nothing',
        actual: await outcomes(cases),
        expected: expectedOf(cases),
      });
    });

    test('admits only the named Launch proof process entry', async () => {
      const cases = launchEntryCases;
      assert({
        given: 'the dedicated proof entry and an adjacent ordinary E2E helper',
        should:
          'permit only the exact named process entry to import or load the app edge',
        actual: await outcomes(cases),
        expected: expectedOf(cases),
      });
    });

    test('rejects mutating process.env or globalThis in app tests', async () => {
      const cases: Case[] = [
        [mutations, 'apps/web/integration/leaky.integration.ts', sixMutations],
        [mutations, web('server/leaky.test.ts'), sixMutations],
        [mutations, 'apps/realtime/src/leaky.test.ts', sixMutations],
      ];
      assert({
        given:
          'an integration suite and two unit tests mutating process.env and globalThis six ways',
        should: 'report every mutation as no-restricted-syntax',
        actual: await outcomes(cases),
        expected: expectedOf(cases),
      });
    });
  });
}
