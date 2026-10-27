import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  selectBrowserSpecs,
  browserOwners,
  queueEnforced,
} from './affected-e2e';
setupRitewayBun();

describe('selectBrowserSpecs', () => {
  test('unknown changes and non-PR events run full', () => {
    for (const event of [
      'push',
      'merge_group',
      'workflow_dispatch',
      'pull_request',
    ]) {
      assert({
        given: `${event} with an unowned input`,
        should: 'select the full suite',
        actual: selectBrowserSpecs(['unowned.ts'], event, true).mode,
        expected: 'full',
      });
    }
  });
  test('queue absence keeps PR evidence full', () => {
    assert({
      given: 'a theme edit before merge queue enforcement',
      should: 'retain the full browser gate',
      actual: selectBrowserSpecs(
        ['apps/web/src/features/theme/theme.ts'],
        'pull_request',
        false,
      ).mode,
      expected: 'full',
    });
  });
  test('owned changes add affected specs to fixed smoke', () => {
    const plan = selectBrowserSpecs(
      ['apps/web/src/features/theme/theme.ts'],
      'pull_request',
      true,
    );
    assert({
      given: 'a theme edit with queue enforcement',
      should: 'select theme coverage plus user journey smoke',
      actual: ['theme', 'app', 'journey-no-js', 'csp'].every((name) =>
        plan.specs.includes(`${name}.e2e.ts`),
      ),
      expected: true,
    });
    assert({
      given: 'a theme-only edit',
      should: 'omit unrelated passkey lifecycle coverage',
      actual: plan.specs.includes('passkey-lifecycle.e2e.ts'),
      expected: false,
    });
  });
  test('PRs and main pushes run Chromium only; the nightly run every project', () => {
    const plan = (event: string) =>
      selectBrowserSpecs(['unowned.ts'], event, false);
    assert({
      given: 'pull_request, push, merge_group, schedule and dispatch runs',
      should: 'pass the Chromium project only on the per-change runs',
      actual: [
        'pull_request',
        'push',
        'merge_group',
        'schedule',
        'workflow_dispatch',
      ].map((event) => plan(event).projectArgs),
      expected: [
        ['--project=chromium'],
        ['--project=chromium'],
        ['--project=chromium'],
        [],
        [],
      ],
    });
    assert({
      given: 'a Chromium-only run and the nightly run',
      should:
        'leave the visual spec, which no Chromium project runs, to nightly',
      actual: ['pull_request', 'schedule'].map((event) =>
        plan(event).specs.includes('visual.e2e.ts'),
      ),
      expected: [false, true],
    });
    assert({
      given: 'a Chromium-only run and the nightly run',
      should: 'install only the browsers the run uses',
      actual: ['pull_request', 'schedule'].map((event) => plan(event).browsers),
      expected: ['chromium', 'chromium firefox webkit'],
    });
  });
  test('every discovered browser spec has explicit ownership', async () => {
    const discovered = [
      ...new Bun.Glob('*.e2e.ts').scanSync('apps/web/e2e'),
    ].sort();
    assert({
      given: 'the actual browser suite',
      should: 'register every spec exactly once',
      actual: Object.keys(browserOwners).sort(),
      expected: discovered,
    });
  });
});

describe('queueEnforced', () => {
  test('partial or unreadable settings never enable selection', () => {
    for (const rules of [null, [], [{ type: 'merge_queue' }]]) {
      assert({
        given: 'missing required gate enforcement',
        should: 'fall back to full',
        actual: queueEnforced(rules),
        expected: false,
      });
    }
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

describe('native path filter', () => {
  const runs = (files: string[]) =>
    selectBrowserSpecs(files, 'pull_request', false).runNative;
  test('a PR runs Isolated Room Launch for room paths, shared runtime and anything unknown', () => {
    for (const file of [
      'apps/web/src/features/rooms/action.ts',
      'apps/web/src/ui/debate-room/view.tsx',
      'apps/web/src/features/round-commands/action.ts',
      'apps/realtime/src/index.ts',
      'apps/web/src/features/messaging/send.ts',
      'packages/media/src/index.ts',
      'packages/debate-engine/src/engine.ts',
      'packages/protocol/src/index.ts',
      'packages/auth/src/session.ts',
      'apps/web/src/features/auth/x.ts',
      'packages/db/src/schema.ts',
      'packages/redis/src/index.ts',
      'bun.lock',
      'package.json',
      'apps/web/src/proxy.ts',
      'apps/web/src/features/access/decision.ts',
      'apps/web/e2e/room-launch.e2e.ts',
      'apps/web/e2e/support/room-launch-runner.ts',
      '.github/workflows/e2e.yml',
      'scripts/affected-e2e.ts',
      'scripts/slot.ts',
    ])
      assert({
        given: `a PR changing ${file}`,
        should: 'run the native suite',
        actual: runs([file]),
        expected: true,
      });
  });
  test('a PR skips it only when every file is documentation or a known non-room area', () => {
    assert({
      given:
        'docs only, theme only, admin only, process files, a mix of those, a mix with one room file, and an empty diff',
      should: 'skip all but the last two',
      actual: [
        ['docs/development/testing.md', 'README.md'],
        ['apps/web/src/features/theme/theme.ts'],
        ['apps/admin/src/page.tsx'],
        ['.claude/skills/task/SKILL.md', 'policy/agent-pipeline/builder.html'],
        ['docs/a.md', 'apps/web/src/ui/dashboard/x.tsx'],
        ['docs/a.md', 'apps/web/src/features/rooms/action.ts'],
        [],
      ].map(runs),
      expected: [false, false, false, false, false, true, true],
    });
  });
  test('main, queue, nightly and dispatch runs always run it', () => {
    assert({
      given: 'every non-PR event with an unrelated change',
      should: 'run the native suite',
      actual: ['push', 'merge_group', 'schedule', 'workflow_dispatch'].map(
        (event) =>
          selectBrowserSpecs(
            ['apps/web/src/features/theme/theme.ts'],
            event,
            false,
          ).runNative,
      ),
      expected: [true, true, true, true],
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

describe('browser prerequisite outcomes', () => {
  type Job = {
    needs?: string | string[];
    if?: string;
    steps?: { run?: string }[];
  };
  const jobs = async () =>
    (
      Bun.YAML.parse(await Bun.file('.github/workflows/e2e.yml').text()) as {
        jobs: Record<string, Job>;
      }
    ).jobs;
  const passes = (job: Job, env: Record<string, string>) =>
    Bun.spawnSync(['sh', '-c', job.steps?.[0]?.run ?? ''], {
      env: { ...process.env, ...env },
    }).exitCode === 0;

  test('the browser suite starts without waiting on the quick check', async () => {
    const workflow = await jobs();
    assert({
      given: 'the browser workflow',
      should: 'run no quick check of its own and gate no suite on one',
      actual: [
        'quick-check' in workflow,
        workflow.e2e.needs,
        workflow.admin.needs,
      ],
      expected: [false, undefined, undefined],
    });
  });

  test('a skipped or failed browser suite cannot mint Playwright E2E', async () => {
    const gate = (await jobs())['playwright-gate'];
    assert({
      given: 'a failed, skipped, cancelled or passing suite',
      should: 'pass only on success',
      actual: {
        condition: gate.if,
        needs: gate.needs,
        results: ['failure', 'skipped', 'cancelled', 'success'].map((state) =>
          passes(gate, { SUITE: state }),
        ),
      },
      expected: {
        condition: 'always()',
        needs: ['e2e'],
        results: [false, false, false, true],
      },
    });
  });

  test('Isolated Room Launch passes skipped only when scope ruled it out', async () => {
    const workflow = await jobs();
    const gate = workflow['native-gate'];
    const cases = [
      ['success', 'true', 'success', true],
      ['success', 'true', 'failure', false],
      ['success', 'true', 'cancelled', false],
      ['success', 'true', 'skipped', false],
      ['success', 'false', 'skipped', true],
      ['failure', '', 'skipped', false],
    ] as const;
    assert({
      given: 'the scope result, its native verdict and the suite result',
      should: 'pass a run or a scoped skip, and nothing else',
      actual: {
        suiteNeeds: workflow['room-launch'].needs,
        suiteIf: workflow['room-launch'].if,
        condition: gate.if,
        needs: gate.needs,
        results: cases.map(([scope, native, suite]) =>
          passes(gate, { SCOPE: scope, NATIVE: native, SUITE: suite }),
        ),
      },
      expected: {
        suiteNeeds: 'scope',
        suiteIf: "needs.scope.outputs.native == 'true'",
        condition: 'always()',
        needs: ['scope', 'room-launch'],
        results: cases.map(([, , , expected]) => expected),
      },
    });
  });
});

describe('queue enforcement identity', () => {
  test('requires every named gate from its expected App', () => {
    const required = [
      'CI gate',
      'Playwright E2E',
      'Isolated Room Launch E2E',
    ].map((context) => ({ context, integration_id: 15368 }));
    const rules = (checks: typeof required) => [
      { type: 'merge_queue' },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: checks },
      },
    ];
    assert({
      given: 'queue and all App-bound checks',
      should: 'allow affected PR selection',
      actual: queueEnforced(rules(required)),
      expected: true,
    });
    for (let index = 0; index < required.length; index += 1) {
      assert({
        given: `missing ${required[index].context}`,
        should: 'retain full PR coverage',
        actual: queueEnforced(
          rules(required.filter((_, position) => position !== index)),
        ),
        expected: false,
      });
    }
    assert({
      given: 'unbound required checks',
      should: 'retain full PR coverage',
      actual: queueEnforced(
        rules(required.map((check) => ({ ...check, integration_id: 0 }))),
      ),
      expected: false,
    });
  });
});

describe('native affected selection', () => {
  test('keeps smoke and expands conservatively', () => {
    for (const [file, count] of [
      ['apps/web/src/features/theme/theme.ts', 1],
      ['packages/media/src/index.ts', 2],
      ['apps/web/src/features/round-commands/action.ts', 8],
      ['packages/auth/src/index.ts', 8],
      ['apps/web/src/features/rooms/action.ts', 8],
      ['apps/web/e2e/support/fixture.ts', 8],
    ] as const) {
      const selected = selectBrowserSpecs(
        [file],
        'pull_request',
        true,
      ).nativeSpecs;
      assert({
        given: file,
        should: 'keep meaningful native smoke and affected coverage',
        actual: {
          count: selected?.length,
          smoke: selected?.includes('room-launch.e2e.ts'),
        },
        expected: { count, smoke: true },
      });
    }
  });
  test('full candidate and unenforced PR retain all native specs', () => {
    for (const [event, enforced] of [
      ['push', true],
      ['merge_group', true],
      ['workflow_dispatch', true],
      ['pull_request', false],
    ] as const)
      assert({
        given: `${event}, queue ${enforced}`,
        should: 'retain eight native specs',
        actual: selectBrowserSpecs(
          ['apps/web/src/features/theme/theme.ts'],
          event,
          enforced,
        ).nativeSpecs?.length,
        expected: 8,
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
