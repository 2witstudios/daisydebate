import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

// The Browser E2E workflow's triggers and gate shells (ADR 0159).
describe('browser workflow triggers', () => {
  test('it runs on every PR, on main, nightly and by choice', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as {
      on: Record<string, { branches?: string[] } | null>;
      concurrency: { group: string; 'cancel-in-progress': string };
    };
    assert({
      given: 'the browser workflow',
      should:
        'run on PRs, main pushes, the nightly schedule and manual dispatch',
      actual: [Object.keys(workflow.on).sort(), workflow.on.push?.branches],
      expected: [
        ['pull_request', 'push', 'schedule', 'workflow_dispatch'],
        ['main'],
      ],
    });
    assert({
      given: 'a newer push to a PR and a later merge to main',
      should:
        "replace only the PR's superseded run, never a main, nightly or dispatched one",
      actual: workflow.concurrency,
      expected: {
        group:
          "${{ github.event_name == 'pull_request' && format('browser-pr-{0}', github.event.pull_request.number) || format('browser-run-{0}', github.run_id) }}",
        'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
      },
    });
  });

  test('the Launch suite runs as shards that together cover every case once', async () => {
    type Step = { id?: string; if?: string; run?: string };
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as {
      jobs: Record<
        string,
        {
          'timeout-minutes': number;
          strategy: { matrix: { cohort: string[] } };
          steps: Step[];
        }
      >;
    };
    const job = workflow.jobs['room-launch']!;
    const launch = job.strategy.matrix.cohort.filter((cohort) =>
      cohort.startsWith('launch-'),
    );
    const step = job.steps.find((candidate) => candidate.id === 'launch');
    // The step's own shell works the shard out of the cohort's name.
    const shards = launch.map((cohort) =>
      Bun.spawnSync(
        [
          'bash',
          '-c',
          (step?.run ?? '').replace('bun test:e2e:room-launch', 'echo'),
        ],
        { env: { ...process.env, LAUNCH_COHORT: cohort } },
      )
        .stdout.toString()
        .trim(),
    );
    assert({
      given: 'the Launch cohorts',
      should:
        'each run one shard of the same total, inside a job bound a PR can wait for',
      actual: {
        shards,
        onlyLaunch: step?.if,
        bounded: job['timeout-minutes'] <= 45,
      },
      expected: {
        shards: launch.map(
          (_, index) => `--shard=${index + 1}/${launch.length}`,
        ),
        onlyLaunch: "${{ startsWith(matrix.cohort, 'launch-') }}",
        bounded: true,
      },
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

  test('a skipped or failed native suite cannot mint Isolated Room Launch E2E', async () => {
    const workflow = await jobs();
    const gate = workflow['native-gate'];
    assert({
      given: 'a failed, skipped, cancelled or passing native suite',
      should: 'pass only on success, with nothing gating the suite itself',
      actual: {
        suiteNeeds: workflow['room-launch'].needs,
        suiteIf: workflow['room-launch'].if,
        condition: gate.if,
        needs: gate.needs,
        results: ['failure', 'skipped', 'cancelled', 'success'].map((state) =>
          passes(gate, { SUITE: state }),
        ),
      },
      expected: {
        suiteNeeds: undefined,
        suiteIf: undefined,
        condition: 'always()',
        needs: ['room-launch'],
        results: [false, false, false, true],
      },
    });
  });
});
