import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomLaunchClaimProblems } from './room-launch-evidence-registration';

setupRitewayBun();

describe('dedicated Room Launch suite registration', () => {
  const registered = {
    rootScript:
      'bun --env-file=.env apps/web/e2e/support/room-launch-runner.ts',
    webScript: 'bun --env-file=../../.env e2e/support/room-launch-runner.ts',
    defaultConfig: `export default defineConfig({testMatch:'**/*.e2e.ts',projects:[{name:'chromium',testIgnore:['**/visual.e2e.ts','**/room-launch.e2e.ts','**/debate-room.e2e.ts']}]});`,
    dedicatedConfig: `export default defineConfig({testMatch:['**/room-launch.e2e.ts','**/debate-room.e2e.ts'],testIgnore:[],projects:[{name:'chromium',testIgnore:[]}]});`,
    runner: `Bun.spawn(['bun','../../scripts/e2e-limit.ts','node','cli','test','--config','e2e/support/room-launch-config.ts']);`,
    workflow:
      'jobs:\n  launch:\n    steps:\n      - run: bun test:e2e:room-launch\n',
  };
  test('accepts the real dedicated runner paired with exact default separation', () => {
    assert({
      given: 'one dedicated enforced job and real runner config',
      should: 'claim Launch exactly once',
      actual: roomLaunchClaimProblems(registered),
      expected: [],
    });
  });
  test('refuses missing runner, duplicated default selection and unrun CI', () => {
    assert({
      given: 'each broken registration boundary',
      should: 'keep missing, duplicate and disabled proof visible',
      actual: [
        roomLaunchClaimProblems({ ...registered, rootScript: '' }).map(
          (p) => p.code,
        ),
        roomLaunchClaimProblems({
          ...registered,
          defaultConfig: registered.defaultConfig.replace(
            "'**/room-launch.e2e.ts'",
            "'**/other.e2e.ts'",
          ),
        }).map((p) => p.code),
        roomLaunchClaimProblems({
          ...registered,
          workflow: registered.workflow.replace(
            '    steps:',
            '    if: false\n    steps:',
          ),
        }).map((p) => p.code),
        roomLaunchClaimProblems({
          ...registered,
          workflow: '# run: bun test:e2e:room-launch',
        }).map((p) => p.code),
        roomLaunchClaimProblems({
          ...registered,
          runner: '// ' + registered.runner,
        }).map((p) => p.code),
      ],
      expected: [
        ['UNRUN_SUITE'],
        ['E2E_DUPLICATED'],
        ['UNRUN_SUITE'],
        ['UNRUN_SUITE'],
        ['UNRUN_SUITE'],
      ],
    });
  });
  test('rejects two enforced jobs claiming the same Launch suite', () => {
    assert({
      given: 'two unconditional CI jobs executing the dedicated command',
      should: 'reject duplicate browser execution claims',
      actual: roomLaunchClaimProblems({
        ...registered,
        workflow: `${registered.workflow}  second:
    steps:
      - run: bun test:e2e:room-launch
`,
      }).map(({ code }) => code),
      expected: ['E2E_DUPLICATED'],
    });
  });
  test('refuses a document suite omitted from either paired selector', () => {
    assert({
      given:
        'an ordinary selector still claiming documents or a dedicated selector not running them',
      should: 'report exact duplicate or unrun document coverage',
      actual: [
        roomLaunchClaimProblems({
          ...registered,
          defaultConfig: registered.defaultConfig.replace(
            "'**/debate-room.e2e.ts'",
            "'**/other.e2e.ts'",
          ),
        }).map(({ code }) => code),
        roomLaunchClaimProblems({
          ...registered,
          dedicatedConfig: registered.dedicatedConfig.replace(
            "'**/debate-room.e2e.ts'",
            "'**/other.e2e.ts'",
          ),
        }).map(({ code }) => code),
      ],
      expected: [['E2E_DUPLICATED'], ['UNRUN_SUITE']],
    });
  });
  test('refuses inherited project exclusions and repeated steps in one job', () => {
    assert({
      given: 'a missing project reset or two actual executions in one CI job',
      should: 'reject hidden or duplicated execution claims',
      actual: [
        roomLaunchClaimProblems({
          ...registered,
          dedicatedConfig: registered.dedicatedConfig.replace(
            "projects:[{name:'chromium',testIgnore:[]}]",
            "projects:[{name:'chromium'}]",
          ),
        }).map(({ code }) => code),
        roomLaunchClaimProblems({
          ...registered,
          workflow:
            registered.workflow + '      - run: bun test:e2e:room-launch\n',
        }).map(({ code }) => code),
      ],
      expected: [['UNRUN_SUITE'], ['E2E_DUPLICATED']],
    });
  });
});
