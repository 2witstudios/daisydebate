import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recordIntegrationReceipt } from './integration-receipts';
import { discoverSuites, INTEGRATION_RUNNER } from './test-integration';
import { selectShard } from './integration-shards';

setupRitewayBun();

test('the actual coverage command requires all workspace receipts from disk', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-receipts-'));
  try {
    let workspaces = 0;
    for (const file of new Bun.Glob('{apps,packages}/*/package.json').scanSync(
      '.',
    )) {
      const manifest = await Bun.file(file).json();
      if (manifest.scripts?.['test:integration'] !== INTEGRATION_RUNNER)
        continue;
      const workspace = file.slice(0, -'/package.json'.length);
      workspaces++;
      for (let index = 1; index <= 4; index++) {
        const shard = `${index}/4`;
        recordIntegrationReceipt(directory, {
          workspace,
          shard,
          files: selectShard(discoverSuites(workspace), shard),
          elapsedMs: 1,
        });
      }
    }
    const run = () =>
      Bun.spawnSync([
        'bun',
        'scripts/check-integration-receipts.ts',
        directory,
      ]);
    const complete = run();
    // This removes an empty partition: coverage union alone would still pass.
    rmSync(join(directory, 'apps-log-shipper-4-4.json'));
    const missing = run();
    assert({
      given:
        'receipts for every current workspace, then a missing empty partition',
      should: 'accept full coverage and reject the incomplete worker evidence',
      actual: {
        workspaces,
        complete: complete.exitCode,
        missing: missing.exitCode !== 0,
        reason: missing.stderr
          .toString()
          .includes('Missing receipt: apps/log-shipper:4/4'),
      },
      expected: { workspaces: 7, complete: 0, missing: true, reason: true },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
