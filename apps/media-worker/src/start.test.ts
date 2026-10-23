import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolve } from 'node:path';
setupRitewayBun();
const run = async (
  entry: string,
  args: string[],
  env: Record<string, string>,
) => {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: resolve(import.meta.dir, '..'),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    signal: AbortSignal.timeout(5000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

test('isolated capture process refuses invalid scope without exporting native diagnostics', async () => {
  assert({
    given: 'the per-session capture entry with invalid IDs and no capabilities',
    should:
      'exit refused without credentials, native hostname or raw exception output',
    actual: await run('src/capture-process.ts', ['invalid'], {}),
    expected: { code: 1, stdout: '', stderr: '' },
  });
});

test('the capture worker refuses to start without its configuration', async () => {
  const secret =
    'postgres://daisy_media_worker_local:never-logged@localhost:1/x';
  const { code, stdout, stderr } = await run('src/start.ts', [], {
    MEDIA_WORKER_DATABASE_URL: secret,
  });
  const lines = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert({
    given: 'a worker database URL but no other required setting',
    should:
      'exit refused with one structured configuration event and no value echoed',
    actual: {
      code,
      stderr,
      events: lines.map((line) => [line.event, line.cause]),
      echoed: stdout.includes('never-logged'),
    },
    expected: {
      code: 1,
      stderr: '',
      events: [['server.shutdown', 'configuration']],
      echoed: false,
    },
  });
});
