import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { browserOwners } from './affected-e2e';
setupRitewayBun();

describe('selection manifest lifecycle', () => {
  test('survives actual Playwright startup', async () => {
    const { mkdtemp, mkdir, rm, readFile, writeFile } =
      await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const scratch = await mkdtemp(join(tmpdir(), 'daisy-selection-'));
    try {
      // No browser/server fixture: Playwright itself performs output cleanup.
      await mkdir(join(scratch, 'apps/web/e2e'), { recursive: true });
      await mkdir(join(scratch, 'apps/web/test-results'), { recursive: true });
      for (const spec of Object.keys(browserOwners))
        await writeFile(join(scratch, 'apps/web/e2e', spec), '');
      const child = Bun.spawnSync(
        ['bun', `${process.cwd()}/scripts/select-e2e.ts`],
        {
          cwd: scratch,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: 'merge_group',
            RUNNER_TEMP: join(scratch, 'runner-temp'),
            GITHUB_ENV: '',
            GITHUB_STEP_SUMMARY: '',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      assert({
        given: 'the full-suite selector in a fixture checkout',
        should: 'produce its manifest',
        actual: child.exitCode,
        expected: 0,
      });
      const output = join(scratch, 'apps/web/test-results');
      await writeFile(join(output, 'removed-by-playwright'), 'sentinel');
      const playwright = join(
        process.cwd(),
        'apps/web/node_modules/@playwright/test',
      );
      await writeFile(
        join(scratch, 'proof.spec.mjs'),
        `import { test } from ${JSON.stringify(join(playwright, 'index.mjs'))};
test('runner starts', () => {});`,
      );
      await writeFile(
        join(scratch, 'playwright.config.mjs'),
        `export default { testDir: '.', testMatch: 'proof.spec.mjs', outputDir: ${JSON.stringify(output)}, reporter: 'line', workers: 1 };`,
      );
      const proof = Bun.spawnSync(
        [
          'node',
          join(playwright, 'cli.js'),
          'test',
          '--config',
          join(scratch, 'playwright.config.mjs'),
        ],
        { cwd: scratch, stdout: 'pipe', stderr: 'pipe' },
      );
      assert({
        given: 'a minimal suite using installed Playwright',
        should: 'complete startup and cleanup without launching a browser',
        actual: {
          code: proof.exitCode,
          cleaned: !(await Bun.file(
            join(output, 'removed-by-playwright'),
          ).exists()),
        },
        expected: { code: 0, cleaned: true },
      });
      const { nativeSpecArguments } =
        await import('../apps/web/e2e/support/affected-projects');
      const { missingSelectedSpecs } = await import('./e2e-selection-report');
      const native = ['room-launch.e2e.ts', 'round-media.e2e.ts'];
      for (const name of [...native, 'ballot.e2e.ts'])
        await writeFile(
          join(scratch, name),
          `import { test } from ${JSON.stringify(join(playwright, 'index.mjs'))};
          test('native selection', () => { ${name === 'ballot.e2e.ts' ? "throw new Error('unselected spec executed');" : ''} });`,
        );
      await writeFile(
        join(scratch, 'playwright.config.mjs'),
        `export default { testDir: '.', testMatch: '*.e2e.ts', outputDir: ${JSON.stringify(output)}, reporter: [['json', {outputFile: 'native.json'}]], workers: 1 };`,
      );
      const selectedRun = Bun.spawnSync(
        [
          'node',
          join(playwright, 'cli.js'),
          'test',
          ...nativeSpecArguments(
            JSON.stringify(native),
            native.map((name) => `**/${name}`),
          ),
        ],
        { cwd: scratch, stdout: 'pipe', stderr: 'pipe' },
      );
      const nativeReport = JSON.parse(
        await readFile(join(scratch, 'native.json'), 'utf8'),
      );
      assert({
        given: 'actual Playwright with selected native filename arguments',
        should:
          'run selected smoke and media while excluding an unrelated failing spec',
        actual: {
          code: selectedRun.exitCode,
          passed: nativeReport.stats.expected,
          missing: missingSelectedSpecs(native, nativeReport),
        },
        expected: { code: 0, passed: 2, missing: [] },
      });
      const manifest = JSON.parse(
        await readFile(join(scratch, 'runner-temp/e2e-selection.json'), 'utf8'),
      );
      assert({
        given: 'Playwright clearing test-results',
        should: 'retain the full selected suite for report verification',
        actual: manifest.specs.length > 0,
        expected: true,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe('selected native outcomes', () => {
  test('discovery alone or skipped tests cannot satisfy a selected spec', async () => {
    const { missingSelectedSpecs } = await import('./e2e-selection-report');
    for (const status of ['skipped', 'failed', 'timedOut', 'passed'])
      assert({
        given: `selected native smoke reports ${status}`,
        should: 'require an actual passed result',
        actual: missingSelectedSpecs(['room-launch.e2e.ts'], {
          suites: [
            {
              specs: [
                {
                  file: 'room-launch.e2e.ts',
                  tests: [{ results: [{ status }] }],
                },
              ],
            },
          ],
        }),
        expected: status === 'passed' ? [] : ['room-launch.e2e.ts'],
      });
  });
});
