import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
const root = new URL('..', import.meta.url).pathname;
const harness = 'apps/web/e2e/support/room-launch-server.ts';
test('the per-address realtime caps are raised only by the browser launch harness', async () => {
  const listed = Bun.spawnSync(['git', 'ls-files'], { cwd: root });
  const files = listed.stdout
    .toString()
    .split('\n')
    .filter(
      (file) =>
        file !== '' &&
        !file.endsWith('.md') &&
        file !== 'packages/config/src/realtime-transport.ts' &&
        file !== 'scripts/realtime-address-caps.test.ts',
    );
  const overriding: string[] = [];
  for (const file of files) {
    const source = Bun.file(`${root}${file}`);
    if (!(await source.exists()) || source.size > 2_000_000) continue;
    if (
      /REALTIME_MAX_(IP_CONNECTIONS|IP_UPGRADES|UNAUTHENTICATED)/.test(
        await source.text(),
      )
    )
      overriding.push(file);
  }
  assert({
    given: 'every tracked file outside the transport config itself',
    should:
      'find the shared-loopback override only in the e2e launch harness, never in deploy, infra or env files',
    actual: overriding,
    expected: [harness],
  });
});
