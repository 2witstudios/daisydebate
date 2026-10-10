import { assert, setupRitewayBun, test } from 'riteway/bun';
import { claimedBrowserSteps } from './browser-ci-claims';
setupRitewayBun();
const gate =
  "${{ !cancelled() && steps.doctor.outcome == 'success' && steps.build.outcome == 'success' && steps.chromium.outcome == 'success' }}";
const workflow = `jobs:
  native:
    steps:
      - id: doctor
        run: bun doctor
      - id: build
        run: bun run build
      - id: chromium
        run: bun apps/web/node_modules/@playwright/test/cli.js install --with-deps chromium
      - run: bun test:e2e:messaging-realtime
        if: "${gate}"
      - run: bun counts
        if: "${'${{ always() && !cancelled() }}'}"
`;
test('native profile gate survives preceding failures only after real prerequisites', () => {
  assert({
    given:
      'the bound doctor/build/browser gate and broken prerequisite variants',
    should:
      'claim the enforced suite only with real prerequisites, never arbitrary skip or ignored failure',
    actual: [
      workflow,
      workflow.replace('bun doctor', 'echo fake'),
      workflow.replace(
        '- id: build',
        '- id: build\n        continue-on-error: true',
      ),
      workflow.replace(gate, 'false'),
    ].map((value) =>
      claimedBrowserSteps(value, 'test:e2e:messaging-realtime', 'bun counts'),
    ),
    expected: [1, 0, 0, 0],
  });
});

test('conditional browser runner requires preceding prerequisites', () => {
  const runner = `      - run: bun test:e2e:messaging-realtime\n        if: "${gate}"\n`;
  const displaced = workflow
    .replace(runner, '')
    .replace('    steps:\n', `    steps:\n${runner}`);
  assert({
    given: 'a gated runner placed before doctor, build and Chromium',
    should: 'refuse the impossible native execution claim',
    actual: claimedBrowserSteps(
      displaced,
      'test:e2e:messaging-realtime',
      'bun counts',
    ),
    expected: 0,
  });
});
