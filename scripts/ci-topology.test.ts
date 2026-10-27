import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

type Job = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  strategy?: { matrix: { task: string[] } };
  steps?: { run?: string }[];
};
const readJobs = async (name: string) =>
  (
    Bun.YAML.parse(await Bun.file(`.github/workflows/${name}.yml`).text()) as {
      jobs: Record<string, Job>;
    }
  ).jobs;
const width = (job: Job) => job.strategy?.matrix.task.length ?? 1;
const initialWidth = (jobs: Record<string, Job>) =>
  Object.values(jobs)
    .filter((job) => !job.needs)
    .reduce((total, job) => total + width(job), 0);

describe('CI quick prerequisite topology', () => {
  test('runs the quick check once and holds only CI work behind it', async () => {
    const ci = await readJobs('ci');
    const browser = await readJobs('e2e');
    assert({
      given: 'the actual CI and browser workflows',
      should:
        'call the reusable quick check from ci.yml alone and hold its expensive jobs',
      actual: {
        prerequisites: [ci.checks, ci.image, ci.integration].map(
          (job) => job.needs,
        ),
        reusable: ci['quick-check']?.uses,
        browserQuickCheck: 'quick-check' in browser,
        initial: initialWidth(ci) + initialWidth(browser),
      },
      expected: {
        prerequisites: Array(3).fill('quick-check'),
        reusable: './.github/workflows/quick-check.yml',
        browserQuickCheck: false,
        // quick-check, audit, migrations, reports; scope, e2e, admin.
        initial: 7,
      },
    });
    assert({
      given: 'the checks matrix after quick success',
      should: 'run only what the quick check does not',
      actual: ci.checks.strategy?.matrix.task,
      expected: ['policy', 'invariants', 'build'],
    });
  });

  test('reports warn without holding the gate, except knip on the nightly run', async () => {
    const ci = await readJobs('ci');
    const steps = (ci.reports.steps ?? []) as {
      run?: string;
      'continue-on-error'?: boolean | string;
    }[];
    const allowance = (run: string) =>
      steps.find((step) => step.run === run)?.['continue-on-error'];
    assert({
      given: 'the advisory reports job',
      should:
        'never gate CI and tolerate findings, with knip strict only when scheduled',
      actual: {
        gated: ci.gate.needs?.includes('reports'),
        knip: allowance('bun run knip'),
        others: [
          'bun run duplication',
          'bun run evidence',
          'bun run metrics:check',
        ].map(allowance),
      },
      expected: {
        gated: false,
        knip: "${{ github.event_name != 'schedule' }}",
        others: [true, true, true],
      },
    });
  });

  test('rejects failure cancellation or skipping in every required job', async () => {
    const { gate } = await readJobs('ci');
    const required = [
      'quick-check',
      'checks',
      'image',
      'audit',
      'migrations',
      'integration',
    ];
    assert({
      given: 'the terminal CI gate',
      should: 'always require quick and every full job',
      actual: { needs: gate.needs, condition: gate.if },
      expected: { needs: required, condition: 'always()' },
    });
    const command = gate.steps?.[0]?.run ?? 'exit 99';
    for (const job of required) {
      const results = ['failure', 'cancelled', 'skipped', 'success'].map(
        (state) =>
          Bun.spawnSync(['sh', '-c', command], {
            env: {
              ...process.env,
              RESULTS: required
                .map((name) => (name === job ? state : 'success'))
                .join(' '),
            },
          }).exitCode,
      );
      assert({
        given: `${job} failure, cancellation, skipping, then success`,
        should: 'only accept all-success using the actual gate shell',
        actual: results,
        expected: [1, 1, 1, 0],
      });
    }
  });
});
