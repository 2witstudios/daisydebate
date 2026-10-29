import { resolve } from 'node:path';
import { discoverSuites, INTEGRATION_RUNNER } from './test-integration';
import { verifyIntegrationReceipts } from './integration-receipts';

const directory = process.argv[2];
if (!directory)
  throw new Error('Usage: check-integration-receipts.ts DIRECTORY');
const inventory: Record<string, readonly string[]> = {};
for (const file of new Bun.Glob('{apps,packages}/*/package.json').scanSync(
  '.',
)) {
  const manifest = await Bun.file(file).json();
  const command = manifest.scripts?.['test:integration'];
  if (!command) continue;
  if (command !== INTEGRATION_RUNNER)
    throw new Error(`Unrecognized integration runner: ${file}`);
  const workspace = file.slice(0, -'/package.json'.length);
  inventory[workspace] = discoverSuites(workspace);
}
const receipts: unknown[] = [];
for (const file of new Bun.Glob('*.json').scanSync(directory))
  receipts.push(await Bun.file(resolve(directory, file)).json());
const problems = verifyIntegrationReceipts(inventory, receipts, 4);
if (problems.length > 0) throw new Error(problems.join('\n'));
process.stdout.write(
  `Integration coverage: ${Object.keys(inventory).length} workspaces, ${Object.values(inventory).flat().length} suites, all four shards complete and disjoint\n`,
);
