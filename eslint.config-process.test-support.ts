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
} from './eslint.config.test-support';

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
        ["export const a = Reflect.get(globalThis, 'a');", route, globals],
        [
          'export const a = globalThis as unknown;',
          web('lib/identity.ts'),
          globals,
        ],
        [
          edgeImport('../../server/'),
          web('features/foundation/leak.ts'),
          imports,
        ],
        [edgeImport('../server/'), web('lib/identity.ts'), imports],
        [edgeImport('../../../../server/'), route, imports],
        [edgeImport('./'), web('server/routes.ts'), imports],
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
        [reads, web('server/process-app.ts'), []],
        [reads, 'apps/realtime/src/start.ts', []],
        [edgeImport('../../../../server/', 'processRoute'), route, []],
        [edgeImport('./server/'), web('proxy.ts'), []],
        [edgeImport('./server/'), web('instrumentation.ts'), []],
        [edgeImport('./'), web('server/start.ts'), []],
        [edgeImport('../server/'), web('lib/request-session.ts'), []],
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
      const proof = 'apps/web/e2e/support/room-launch-server.ts';
      const ordinary = 'apps/web/e2e/support/room-launch-adjacent.ts';
      const cases: Case[] = [
        [edgeImport('../../src/server/', 'adoptProcessApp'), proof, []],
        [lazyEdge('../../src/server/process-app'), proof, []],
        [edgeImport('../../src/server/', 'adoptProcessApp'), ordinary, imports],
        [
          lazyEdge('../../src/server/process-app'),
          ordinary,
          escapeRule(lazyEdge('../../src/server/process-app')),
        ],
      ];
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
