import { assert, setupRitewayBun, test } from 'riteway/bun';
import { realtimeClaimProblems } from './realtime-evidence-registration';

setupRitewayBun();
const rootScripts = {
  'test:e2e:realtime':
    'bun --env-file=.env apps/web/e2e/support/realtime-runner.ts room',
  'test:e2e:messaging-realtime':
    'bun --env-file=.env apps/web/e2e/support/realtime-runner.ts messaging',
};
const webScripts = Object.fromEntries(
  Object.entries(rootScripts).map(([key, value]) => [
    key,
    value.replace('--env-file=.env apps/web/', '--env-file=../../.env '),
  ]),
);
const config = (spec: string) =>
  `export default defineConfig({testMatch:'**/${spec}.e2e.ts',outputDir:'test-results/${spec === 'realtime-room-delivery' ? 'realtime' : 'messaging-realtime'}',testIgnore:[],projects:[{name:'chromium',testIgnore:[]}]});`;
const registered = {
  rootScripts,
  webScripts,
  defaultConfig:
    "export default defineConfig({projects:[{name:'chromium',testIgnore:['**/realtime-room-delivery.e2e.ts','**/messaging-realtime.e2e.ts']}]});",
  roomConfig: config('realtime-room-delivery'),
  messagingConfig: config('messaging-realtime'),
  runner:
    "import { realtimeProofProfile } from './realtime-profile';const profile=realtimeProofProfile(Bun.argv[2]);Bun.spawn(['bun','../../scripts/e2e-limit.ts','node','cli','test','--config',profile.config]);",
  profileSource:
    "export function realtimeProofProfile(name){switch(name){case 'room':return {config:'e2e/support/realtime-config.ts'};case 'messaging':return {config:'e2e/support/messaging-realtime-config.ts'};default:throw new Error('refused');}}",
  workflow:
    'jobs:\n  native:\n    steps:\n      - run: bun test:e2e:room-launch\n      - run: bun test:e2e:realtime\n      - run: bun scripts/e2e-report-counts.ts apps/web/test-results/realtime-results.json\n      - run: bun test:e2e:messaging-realtime\n      - run: bun scripts/e2e-report-counts.ts apps/web/test-results/messaging-realtime-results.json\n',
};
test('one native job claims both actual profiles with exact separation and reports', () => {
  assert({
    given: 'the two dedicated native profiles and their actual report counters',
    should: 'claim both suites exactly once',
    actual: realtimeClaimProblems(registered),
    expected: [],
  });
});
test('a hidden or absent report counter cannot claim completed browser evidence', () => {
  const outcomes = ['', 'if: false\n        run:'].map((replacement) => {
    const workflow = replacement
      ? registered.workflow.replace(
          '- run: bun scripts/e2e-report-counts.ts',
          `- ${replacement} bun scripts/e2e-report-counts.ts`,
        )
      : registered.workflow.replace(
          / {6}- run: bun scripts\/e2e-report-counts.ts[^\n]*\n/g,
          '',
        );
    return realtimeClaimProblems({ ...registered, workflow }).map(
      (problem) => problem.code,
    );
  });
  assert({
    given: 'missing counters or an if-false counter',
    should: 'refuse the unreported native proof claims',
    actual: outcomes,
    expected: [['UNRUN_SUITE', 'UNRUN_SUITE'], ['UNRUN_SUITE']],
  });
});
test('wrong profile binding, inherited ignore and missing runner remain visible', () => {
  const inputs = [
    {
      ...registered,
      runner: registered.runner.replace('Bun.argv[2]', 'ignored'),
    },
    {
      ...registered,
      roomConfig: registered.roomConfig.replace(
        'testIgnore:[]',
        'testIgnore:undefined',
      ),
    },
    { ...registered, rootScripts: { ...rootScripts, 'test:e2e:realtime': '' } },
  ];
  assert({
    given:
      'a disconnected profile selector, inherited ignore or absent root command',
    should: 'reject each broken execution boundary',
    actual: inputs.map((input) =>
      realtimeClaimProblems(input).map((problem) => problem.code),
    ),
    expected: [
      ['UNRUN_SUITE', 'UNRUN_SUITE'],
      ['UNRUN_SUITE'],
      ['UNRUN_SUITE'],
    ],
  });
});

test('dedicated output cannot erase earlier native profile evidence', () => {
  assert({
    given:
      'a dedicated transport config inheriting the global test-results directory',
    should:
      'refuse a profile that would erase earlier native reports and traces',
    actual: realtimeClaimProblems({
      ...registered,
      roomConfig: registered.roomConfig.replace(
        'test-results/realtime',
        'test-results',
      ),
    }).map((problem) => problem.code),
    expected: ['UNRUN_SUITE'],
  });
});

test('split native jobs, ignored counters and displaced config arguments cannot claim proof', () => {
  const split = registered.workflow.replace(
    '      - run: bun test:e2e:messaging-realtime',
    '  separate:\n    steps:\n      - run: bun test:e2e:messaging-realtime',
  );
  const ignored = registered.workflow.replace(
    '- run: bun scripts/e2e-report-counts.ts',
    '- continue-on-error: true\n        run: bun scripts/e2e-report-counts.ts',
  );
  const displaced = registered.runner.replace(
    "'--config',profile.config",
    "'--config','other.ts',profile.config",
  );
  assert({
    given:
      'split jobs, an ignored reporter failure or a trailing unused profile config',
    should: 'reject each unsupported proof claim',
    actual: [
      realtimeClaimProblems({ ...registered, workflow: split }).length > 0,
      realtimeClaimProblems({ ...registered, workflow: ignored }).length > 0,
      realtimeClaimProblems({ ...registered, runner: displaced }).length > 0,
    ],
    expected: [true, true, true],
  });
});
