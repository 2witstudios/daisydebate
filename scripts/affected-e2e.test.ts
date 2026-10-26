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
