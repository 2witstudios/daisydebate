import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

type Job = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  strategy?: { matrix: Record<string, string[]> };
  steps?: { run?: string }[];
};
const readJobs = async (name: string) =>
  (
    Bun.YAML.parse(await Bun.file(`.github/workflows/${name}.yml`).text()) as {
      jobs: Record<string, Job>;
    }
  ).jobs;
const width = (job: Job) =>
  job.strategy
    ? Object.values(job.strategy.matrix).reduce(
        (total, dimension) => total * dimension.length,
        1,
      )
    : 1;
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
        // quick-check, audit, migrations, reports; e2e, admin, seven native
        // cohorts (five Launch shards, realtime, messaging).
        initial: 13,
      },
    });
    assert({
      given: 'the checks matrix after quick success',
      should: 'run only what the quick check does not',
      actual: ci.checks.strategy?.matrix.task,
      expected: ['policy', 'invariants', 'build', 'knip', 'knip:production'],
    });
  });

  test('reports warn without holding the gate, while both knip passes are required checks', async () => {
    const ci = await readJobs('ci');
    const steps = (ci.reports.steps ?? []) as {
      run?: string;
      'continue-on-error'?: boolean | string;
    }[];
    const allowance = (run: string) =>
      steps.find((step) => step.run === run)?.['continue-on-error'];
    assert({
      given: 'the advisory reports job and the checks matrix',
      should:
        'never gate CI on a report, and run both dead-code passes among the required checks',
      actual: {
        gated: ci.gate.needs?.includes('reports'),
        reports: [
          'bun run duplication',
          'bun run evidence',
          'bun run metrics:check',
        ].map(allowance),
        knipIsRequired:
          ci.checks.strategy?.matrix.task.includes('knip') &&
          ci.checks.strategy.matrix.task.includes('knip:production') &&
          ci.gate.needs?.includes('checks'),
        knipIsAReport: steps.some((step) =>
          ['bun run knip', 'bun run knip:production'].includes(step.run ?? ''),
        ),
      },
      expected: {
        gated: false,
        reports: [true, true, true],
        knipIsRequired: true,
        knipIsAReport: false,
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
      'integration-coverage',
    ];
    assert({
      given: 'the terminal CI gate',
      should: 'always require quick and every full job',
      actual: { needs: gate.needs, condition: gate.if },
      expected: { needs: required, condition: 'always()' },
    });
    const command = gate.steps?.[0]?.run ?? 'exit 99';
    for (const job of required) {
      const results = ['failure', 'cancelled', 'skipped', '', 'success'].map(
        (state) =>
          Bun.spawnSync(['bash', '-c', command], {
            env: {
              ...process.env,
              RESULTS: required
                .map((name) => (name === job ? state : 'success'))
                .join(' '),
            },
          }).exitCode,
      );
      assert({
        given: `${job} failure, cancellation, skipping, missing result, then success`,
        should: 'only accept all-success using the actual gate shell',
        actual: results,
        expected: [1, 1, 1, 1, 0],
      });
    }
  });
});
