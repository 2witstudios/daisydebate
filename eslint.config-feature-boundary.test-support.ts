import { assert, describe, test } from 'riteway/bun';
import { repositoryEslint, web } from './eslint.config.test-support';

const message =
  "server/ and lib/ import no feature: move the code into its feature, or start the feature's work from the one feature list (server/process-work.ts) (ADR 0917).";

const messagesOf = async (code: string, filePath: string) => {
  const [result] = await repositoryEslint().lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((found) => found.message)
    .filter((text) => text.includes(message));
};

const featureImport = (from: string) =>
  `import { startBillingWork } from '${from}features/billing/work';\nexport const x = startBillingWork;`;
const featureLoad = (from: string) =>
  `export const x = () => import('${from}features/billing/work');`;

export function registerFeatureBoundaryTests() {
  describe('server/ and lib/ import no feature (RECON-4.6, ADR 0917)', () => {
    test('refuses a feature import from shared source, by any spelling', async () => {
      const refused = await Promise.all([
        messagesOf(featureImport('../'), web('server/billing-worker.ts')),
        messagesOf(featureImport('../'), web('lib/billing.ts')),
        messagesOf(featureImport('../../'), web('server/nested/x.ts')),
        messagesOf(featureLoad('../'), web('server/lazy-billing.ts')),
        messagesOf(
          'export type { ProcessWork } from "../features/billing/work";',
          web('server/re-export.ts'),
        ),
        messagesOf(featureImport('./'), web('server/start.ts')),
        messagesOf(featureImport('../'), web('lib/page-reads.ts')),
      ]);
      assert({
        given:
          'a server module, a lib module, a nested server module, a dynamic import, a type re-export, the production start and the request scope reaching a feature',
        should: 'refuse each with the boundary message',
        actual: refused.map((found) => found.length),
        expected: [1, 1, 1, 1, 1, 1, 1],
      });
    });

    test('admits the one feature list and the composers the ADR names', async () => {
      const admitted = await Promise.all(
        [
          'server/process-work.ts',
          'server/app.ts',
          'server/process-app.ts',
          'server/proxy-handler.ts',
          'server/retention-targets.ts',
          'server/app.test.ts',
        ].map((path) => messagesOf(featureImport('../'), web(path))),
      );
      assert({
        given: 'the feature list, the four composers and a server test',
        should: 'report no boundary violation',
        actual: admitted.map((found) => found.length),
        expected: [0, 0, 0, 0, 0, 0],
      });
    });
  });
}
