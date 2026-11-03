import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { nativeSpecs, selectBrowserSpecs } from './browser-selection';
setupRitewayBun();

const discovered = [
  ...new Bun.Glob('*.e2e.ts').scanSync('apps/web/e2e'),
].sort();

describe('selectBrowserSpecs', () => {
  const plan = (event: string) => selectBrowserSpecs(discovered, event);

  test('main pushes run Chromium only; the nightly and dispatched runs every project', () => {
    assert({
      given: 'push, schedule and dispatch runs',
      should: 'pass the Chromium project only on a main push',
      actual: ['push', 'schedule', 'workflow_dispatch'].map(
        (event) => plan(event).projectArgs,
      ),
      expected: [['--project=chromium'], [], []],
    });
    assert({
      given: 'a Chromium-only run and the nightly run',
      should:
        'leave the visual spec, which no Chromium project runs, to nightly',
      actual: ['push', 'schedule'].map((event) => [
        plan(event).specs.includes('visual.e2e.ts'),
        plan(event).excluded,
      ]),
      expected: [
        [false, ['visual.e2e.ts']],
        [true, []],
      ],
    });
    assert({
      given: 'a Chromium-only run and the nightly run',
      should: 'install only the browsers the run uses',
      actual: ['push', 'schedule'].map((event) => plan(event).browsers),
      expected: ['chromium', 'chromium firefox webkit'],
    });
  });

  test('every run keeps the whole inventory', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch'])
      assert({
        given: `a ${event} run`,
        should: 'run all sixteen launch specs and every other non-native spec',
        actual: [
          plan(event).nativeSpecs.length,
          [...plan(event).specs, ...plan(event).excluded].sort(),
        ],
        expected: [
          16,
          discovered.filter((spec) => !nativeSpecs.includes(spec)),
        ],
      });
  });

  test('native specs run only in the native job', () => {
    const { nativeSpecs: launch, specs } = plan('push');
    assert({
      given: 'the attachment, notes and timing proofs',
      should: 'select them for launch and never for the ordinary browser job',
      actual: [
        'media-stage.e2e.ts',
        'round-media.e2e.ts',
        'round-notes-recovery.e2e.ts',
        'round-timing-skew.e2e.ts',
      ].map((spec) => [launch.includes(spec), specs.includes(spec)]),
      expected: [
        [true, false],
        [true, false],
        [true, false],
        [true, false],
      ],
    });
  });

  test('every native spec exists', () => {
    assert({
      given: 'the native spec list and the actual browser suite',
      should: 'name no spec that does not exist',
      actual: nativeSpecs.filter((spec) => !discovered.includes(spec)),
      expected: [],
    });
  });
});

describe('affectedExclusions', () => {
  test('creates exact spec exclusions', async () => {
    const { affectedExclusions } =
      await import('../apps/web/e2e/support/affected-projects');
    assert({
      given: 'an affected exclusion list',
      should: 'exclude only the named files',
      actual: affectedExclusions('["theme.e2e.ts"]'),
      expected: ['**/theme.e2e.ts'],
    });
  });
});

describe('missingSelectedSpecs', () => {
  test('detects a missing selected spec despite other passing tests', async () => {
    const { missingSelectedSpecs } = await import('./e2e-selection-report');
    assert({
      given: 'a nonempty report missing required smoke',
      should: 'reject the absent spec',
      actual: missingSelectedSpecs(['app.e2e.ts', 'csp.e2e.ts'], {
        suites: [
          {
            specs: [
              {
                file: 'app.e2e.ts',
                tests: [{ results: [{ status: 'passed' }] }],
              },
            ],
          },
        ],
      }),
      expected: ['csp.e2e.ts'],
    });
  });
});

describe('browser workflow selection wiring', () => {
  test('generates a selection before browser execution and verifies its report', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as {
      jobs: {
        e2e: { steps: { run?: string }[] };
        'room-launch': { needs: string };
      };
    };
    const commands = workflow.jobs.e2e.steps.map(({ run }) => run);
    const playwright = commands.findIndex((run) =>
      run?.startsWith('bun run --cwd apps/web test:e2e'),
    );
    assert({
      given: 'the actual browser workflow',
      should: 'write selection before invoking Playwright',
      actual:
        commands.indexOf('bun scripts/select-e2e.ts') >= 0 &&
        commands.indexOf('bun scripts/select-e2e.ts') < playwright,
      expected: true,
    });
    assert({
      given: 'the actual browser workflow',
      should: 'pass the selected Playwright projects',
      actual: commands[playwright],
      expected: 'bun run --cwd apps/web test:e2e $DAISY_E2E_PROJECT_ARGS',
    });
    assert({
      given: 'the actual browser workflow',
      should: 'verify every selected spec was discovered',
      actual: commands.includes('bun scripts/e2e-selection-report.ts'),
      expected: true,
    });
  });
});

describe('native selection admission', () => {
  test('rejects empty unknown or smoke-free selections', async () => {
    const { nativeSpecArguments } =
      await import('../apps/web/e2e/support/affected-projects');
    const inventory = ['**/room-launch.e2e.ts', '**/round-media.e2e.ts'];
    for (const selection of [
      [],
      ['round-media.e2e.ts'],
      ['room-launch.e2e.ts', 'unknown.e2e.ts'],
      ['room-launch.e2e.ts', 'room-launch.e2e.ts'],
    ]) {
      let rejected = false;
      try {
        nativeSpecArguments(JSON.stringify(selection), inventory);
      } catch {
        rejected = true;
      }
      assert({
        given: JSON.stringify(selection),
        should: 'fail closed',
        actual: rejected,
        expected: true,
      });
    }
    const args = nativeSpecArguments('["room-launch.e2e.ts"]', inventory);
    assert({
      given: 'valid native smoke',
      should: 'match exactly its filename',
      actual: [
        'path/room-launch.e2e.ts',
        'path/other-room-launch.e2e.ts',
        'path/room-launchXe2eXts',
      ].map((file) => new RegExp(args[0]).test(file)),
      expected: [true, false, false],
    });
  });
  test('native workflow selects and checks its own report', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as { jobs: Record<string, { steps: { run?: string }[] }> };
    const commands = workflow.jobs['room-launch'].steps.map(({ run }) => run);
    assert({
      given: 'the isolated native job',
      should: 'select before execution and validate afterwards',
      actual:
        commands.indexOf('bun scripts/select-e2e.ts') <
          commands.indexOf('bun test:e2e:room-launch') &&
        commands.includes('bun scripts/e2e-selection-report.ts room-launch'),
      expected: true,
    });
  });
});

test('the selection gate requires passing evidence from both browser runs', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'daisy-analytics-evidence-'));
  const report = (file: string, status: string) => ({
    file,
    tests: [{ results: [{ status }] }],
  });
  try {
    const results = join(directory, 'apps/web/test-results');
    await mkdir(join(results, 'analytics-native'), { recursive: true });
    await writeFile(
      join(directory, 'e2e-selection.json'),
      JSON.stringify({ specs: ['app.e2e.ts', 'analytics-native.e2e.ts'] }),
    );
    await writeFile(
      join(results, 'results.json'),
      JSON.stringify(report('app.e2e.ts', 'passed')),
    );
    const outcomes: number[] = [];
    for (const status of ['passed', 'failed', 'missing']) {
      const analytics = join(results, 'analytics-native/results.json');
      if (status === 'missing') await rm(analytics);
      else
        await writeFile(
          analytics,
          JSON.stringify(report('analytics-native.e2e.ts', status)),
        );
      const process = Bun.spawn(
        ['bun', resolve('scripts/e2e-selection-report.ts')],
        {
          cwd: directory,
          env: { ...Bun.env, RUNNER_TEMP: directory },
          stdout: 'ignore',
          stderr: 'ignore',
        },
      );
      outcomes.push(await process.exited);
    }
    assert({
      given:
        'separate ordinary and analytics reports, then failed or missing analytics proof',
      should: 'accept only complete passing evidence across both runs',
      actual: outcomes,
      expected: [0, 1, 1],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
