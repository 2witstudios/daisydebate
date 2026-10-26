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
      should: 'select theme and visual coverage plus user journey smoke',
      actual: ['theme', 'visual', 'app', 'journey-no-js', 'csp'].every((name) =>
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
        suites: [{ specs: [{ file: 'app.e2e.ts', tests: [{}] }] }],
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
    assert({
      given: 'the actual browser workflow',
      should: 'write selection before invoking Playwright',
      actual:
        commands.indexOf('bun scripts/select-e2e.ts') >= 0 &&
        commands.indexOf('bun scripts/select-e2e.ts') <
          commands.indexOf('bun run --cwd apps/web test:e2e'),
      expected: true,
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
  test('skipped expensive jobs cannot mint successful required checks', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as {
      jobs: Record<
        string,
        { needs: string | string[]; if?: string; steps?: { run?: string }[] }
      >;
    };
    for (const [suite, gate] of [
      ['e2e', 'playwright-gate'],
      ['room-launch', 'native-gate'],
    ]) {
      assert({
        given: `${suite} expensive browser work`,
        should: 'wait for quick-check',
        actual: workflow.jobs[suite].needs,
        expected: 'quick-check',
      });
      const terminal = workflow.jobs[gate];
      const command = terminal.steps?.[0]?.run ?? '';
      const results = ['failure', 'skipped', 'cancelled', 'success'].map(
        (state) =>
          Bun.spawnSync(['sh', '-c', command], {
            env: { ...process.env, QUICK: 'success', SUITE: state },
          }).exitCode === 0,
      );
      assert({
        given: 'a failed skipped or cancelled suite',
        should: 'fail the always-running terminal check',
        actual: { condition: terminal.if, needs: terminal.needs, results },
        expected: {
          condition: 'always()',
          needs: ['quick-check', suite],
          results: [false, false, false, true],
        },
      });
    }
  });
});

describe('queue enforcement identity', () => {
  test('requires every named gate from its expected App', () => {
    const required = [
      'CI gate',
      'Playwright E2E',
      'Isolated Room Launch E2E',
      'review-record',
    ].map((context) => ({
      context,
      integration_id: context === 'review-record' ? 5049967 : 15368,
    }));
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
