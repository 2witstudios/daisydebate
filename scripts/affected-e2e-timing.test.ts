import { assert, setupRitewayBun, test } from 'riteway/bun';
import { selectBrowserSpecs } from './affected-e2e';
setupRitewayBun();

test('the timing proof belongs only to the dedicated launch runner in full and affected selection', () => {
  const spec = 'round-timing-skew.e2e.ts';
  assert({
    given:
      'a timing proof edit with enforced affected selection or full fallback',
    should:
      'require the spec in native acceptance and never in the ordinary runner report',
    actual: [true, false].map((enforced) => {
      const selection = selectBrowserSpecs(
        [`apps/web/e2e/${spec}`],
        'pull_request',
        enforced,
      );
      return [
        selection.specs.includes(spec),
        selection.nativeSpecs.includes(spec),
        selection.runNative,
      ];
    }),
    expected: [
      [false, true, true],
      [false, true, true],
    ],
  });
});

test('full and affected timing selections are admitted by the canonical dedicated launch inventory', async () => {
  const { nativeSpecArguments } =
    await import('../apps/web/e2e/support/affected-projects');
  const source = await Bun.file(
    new URL('../apps/web/e2e/support/room-launch-config.ts', import.meta.url),
  ).text();
  const declared = source.match(/testMatch:\s*\[([\s\S]*?)\]/)?.[1];
  if (!declared) throw new Error('Canonical launch inventory must be declared');
  const inventory = [...declared.matchAll(/'([^']+)'/g)].map(
    (match) => match[1]!,
  );
  const spec = 'round-timing-skew.e2e.ts';
  assert({
    given:
      'the actual dedicated launch config and its production selection argument adapter',
    should:
      'admit and collect timing proof for full fallback and affected selection',
    actual: [true, false].map((enforced) => {
      const selection = selectBrowserSpecs(
        [`apps/web/e2e/${spec}`],
        'pull_request',
        enforced,
      );
      const args = nativeSpecArguments(
        JSON.stringify(selection.nativeSpecs),
        inventory,
      );
      return [
        inventory.includes(`**/${spec}`),
        args.some((pattern) => new RegExp(pattern).test(spec)),
        selection.specs.includes(spec),
      ];
    }),
    expected: [
      [true, true, false],
      [true, true, false],
    ],
  });
});
