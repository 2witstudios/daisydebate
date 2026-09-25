import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import rootPackage from '../package.json';
import {
  claimsIntegrationSuite,
  discoverSuites,
  exitCodeOf,
  INTEGRATION_RUNNER,
  integrationSuites,
} from './test-integration';

setupRitewayBun();

describe('integration suite discovery', () => {
  test('finds suites by folder and suffix, in a stable order', () => {
    assert({
      given:
        'files under integration/ and elsewhere, and an old .integration.test.ts name',
      should: 'keep integration suites only, sorted',
      actual: integrationSuites([
        'integration/redis.integration.ts',
        'integration/seed.integration.ts',
        'integration/legacy.integration.test.ts',
        'integration/webauthn-authenticator.smoke.integration.ts',
        'integration/support/fixtures.ts',
        'src/index.test.ts',
        'integration/nested/outbox.integration.ts',
      ]),
      expected: [
        'integration/nested/outbox.integration.ts',
        'integration/redis.integration.ts',
        'integration/seed.integration.ts',
        'integration/webauthn-authenticator.smoke.integration.ts',
      ],
    });
  });

  test('lets bun evidence count every discovered suite as claimed', () => {
    assert({
      given: 'the discovery runner, and a hand-kept list that misses a file',
      should: 'claim any suite under integration/ only for the runner',
      actual: [
        claimsIntegrationSuite(
          INTEGRATION_RUNNER,
          'packages/db/integration/new.integration.ts',
        ),
        claimsIntegrationSuite(
          'bun test ./integration/old.integration.ts',
          'packages/db/integration/new.integration.ts',
        ),
        claimsIntegrationSuite(
          INTEGRATION_RUNNER,
          'packages/db/src/not-integration.ts',
        ),
        // The runner scans only <workspace>/integration/, never a nested one.
        claimsIntegrationSuite(
          INTEGRATION_RUNNER,
          'packages/db/src/outbox/integration/x.integration.ts',
        ),
      ],
      expected: [true, false, false, false],
    });
  });
});

describe('running the suites', () => {
  test('discovers .tsx suites as well as .ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grd-6-integration-'));
    mkdirSync(join(dir, 'integration'));
    for (const name of ['ui.integration.tsx', 'db.integration.ts', 'x.ts'])
      writeFileSync(join(dir, 'integration', name), '');
    assert({
      given:
        'an integration folder with a .tsx suite, a .ts suite and a helper',
      should:
        'run both suites, so bun evidence never counts one that is skipped',
      actual: discoverSuites(dir),
      expected: [
        'integration/db.integration.ts',
        'integration/ui.integration.tsx',
      ],
    });
  });

  test('fails when bun test dies from a signal', () => {
    const killed = Bun.spawnSync(['sh', '-c', 'kill -9 $$']);
    assert({
      given:
        'a run killed by SIGKILL (exit code null), a failing run and a passing one',
      should: 'exit non-zero for the first two and zero for the last',
      actual: [
        exitCodeOf(killed),
        exitCodeOf({ exitCode: 3, signalCode: null }),
        exitCodeOf({ exitCode: 0, signalCode: null }),
      ],
      expected: [137, 3, 0],
    });
  });

  test("runs one workspace's suites at a time, never two against the shared test database", () => {
    // ISSUE-61, ISSUE-100: @daisy/db's out-of-order proof holds transaction
    // A open on outbox while it inserts B; @daisy/web's fixtures CREATE
    // TRIGGER on outbox and session. Run side by side on one database, the
    // queued trigger waits on A and B's insert waits on the trigger: a lock
    // queue Postgres cannot see as a deadlock, since A waits on B in the
    // client, so the db tests hit their timeout and the web app's
    // lock_timeout answers 502.
    assert({
      given: 'the root test:integration script',
      should: 'run turbo with a concurrency of one',
      actual: rootPackage.scripts['test:integration']
        .split(/\s+/)
        .includes('--concurrency=1'),
      expected: true,
    });
  });
});
