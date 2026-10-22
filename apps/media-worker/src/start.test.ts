import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolve } from 'node:path';
setupRitewayBun();
test('isolated capture process refuses invalid scope without exporting native diagnostics', async () => {
  const child = Bun.spawn([process.execPath, 'src/start.ts', 'invalid'], {
    cwd: resolve(import.meta.dir, '..'),
    env: {},
    stdout: 'pipe',
    stderr: 'pipe',
    signal: AbortSignal.timeout(5000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert({
    given:
      'the actual public process entry with invalid IDs and no capabilities',
    should:
      'exit refused without credentials, native hostname or raw exception output',
    actual: { code, stdout, stderr },
    expected: { code: 1, stdout: '', stderr: '' },
  });
});
