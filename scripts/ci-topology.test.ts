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
  test('holds every expensive job while preserving the full matrix', async () => {
    const ci = await readJobs('ci');
    const browser = await readJobs('e2e');
    const expensive = [
      ci.checks,
      ci.image,
      ci.integration,
      browser.e2e,
      browser['room-launch'],
    ];
    assert({
      given: 'the actual CI and browser workflows',
      should: 'hold all 15 expensive jobs behind reusable quick checks',
      actual: {
        prerequisites: expensive.map((job) => job.needs),
        held: expensive.reduce((total, job) => total + width(job), 0),
        reusable: ci['quick-check']?.uses,
        initial: initialWidth(ci) + initialWidth(browser),
      },
      expected: {
        prerequisites: Array(5).fill('quick-check'),
        held: 15,
        reusable: './.github/workflows/quick-check.yml',
        initial: 4,
      },
    });
    assert({
      given: 'the full checks matrix after quick success',
      should: 'retain every existing task including build',
      actual: ci.checks.strategy?.matrix.task,
      expected: [
        'format:check',
        'lint',
        'policy',
        'knip',
        'duplication',
        'invariants',
        'evidence',
        'metrics:check',
        'typecheck',
        'test',
        'build',
      ],
    });
    assert({
      given: 'a regression removing the matrix dependency',
      should: 'expose eleven extra initial jobs to the topology measurement',
      actual:
        initialWidth({ ...ci, checks: { ...ci.checks, needs: undefined } }) -
        initialWidth(ci),
      expected: 11,
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
