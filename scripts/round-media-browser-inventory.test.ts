import { assert, setupRitewayBun, test } from 'riteway/bun';
import { selectBrowserSpecs } from './affected-e2e';
import { missingSelectedSpecs } from './e2e-selection-report';
import { nativeSpecArguments } from '../apps/web/e2e/support/affected-projects';
setupRitewayBun();

const mediaSpecs = [
  'round-media.e2e.ts',
  'round-media-recovery.e2e.ts',
  'round-media-source-isolation.e2e.ts',
  'round-media-lifecycle.e2e.ts',
];

for (const spec of mediaSpecs)
  test(`${spec} belongs only to the native full and affected inventories`, async () => {
    const [ordinary, dedicated] = await Promise.all([
      Bun.file('apps/web/playwright.config.ts').text(),
      Bun.file('apps/web/e2e/support/room-launch-config.ts').text(),
    ]);
    const inventory = [...dedicated.matchAll(/'([^']+\.e2e\.ts)'/g)].map(
      (match) => match[1],
    );
    const plans = [
      selectBrowserSpecs([`apps/web/e2e/${spec}`], 'pull_request', true),
      selectBrowserSpecs(
        ['apps/web/src/features/round-media/browser-transport.ts'],
        'pull_request',
        true,
      ),
      selectBrowserSpecs(['unowned.ts'], 'pull_request', true),
      selectBrowserSpecs([], 'push', false),
    ];
    let admitted = false;
    try {
      admitted =
        nativeSpecArguments(
          JSON.stringify(['room-launch.e2e.ts', spec]),
          inventory,
        ).length === 2;
    } catch {
      /* An inventory hole must remain a failed assertion. */
    }
    assert({
      given: `${spec} directly changed, source affected, unknown/full PR and full push`,
      should:
        'exclude ordinary execution, retain native execution and admit its exact CI runner selection',
      actual: {
        ordinary: ordinary.includes(`'**/${spec}'`),
        dedicated: inventory.includes(`**/${spec}`),
        admitted,
        plans: plans.map((plan) => [
          plan.mode,
          plan.specs.includes(spec),
          plan.nativeSpecs.includes(spec),
        ]),
      },
      expected: {
        ordinary: true,
        dedicated: true,
        admitted: true,
        plans: [
          ['affected', false, true],
          ['affected', false, true],
          ['full', false, true],
          ['full', false, true],
        ],
      },
    });
  });

test('the report guard still rejects each omitted split media journey', () => {
  for (const omitted of mediaSpecs) {
    const report = mediaSpecs
      .filter((spec) => spec !== omitted)
      .map((file) => ({
        file,
        tests: [{ results: [{ status: 'passed' }] }],
      }));
    assert({
      given: `a report passing every selected media spec except ${omitted}`,
      should:
        'keep the omitted execution visible instead of accepting a nonempty report',
      actual: missingSelectedSpecs(mediaSpecs, report),
      expected: [omitted],
    });
  }
});
