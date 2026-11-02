import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

// The Browser E2E workflow's triggers and gate shells (ADR 0098).
describe('browser workflow triggers', () => {
  test('it runs after merge or by choice, never as a PR check', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as { on: Record<string, { branches?: string[] }> };
    assert({
      given: 'the browser workflow',
      should: 'run on main pushes, the nightly schedule and manual dispatch',
      actual: [Object.keys(workflow.on).sort(), workflow.on.push?.branches],
      expected: [['push', 'schedule', 'workflow_dispatch'], ['main']],
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
