import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { selectBrowserSpecs } from './affected-e2e';
setupRitewayBun();

// The Isolated Room Launch path filter and the browser gate shells (ADR 0083).
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
