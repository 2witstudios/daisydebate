import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('latest history without realtime takes the authorized counts after adding and withdrawing', async () => {
  const child = Bun.spawn(
    [
      'bun',
      `${import.meta.dir}/../../../scripts/messaging-reaction-realm.test-support.ts`,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 25000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(`Reaction realm failed: ${stderr}`);
  assert({
    given:
      'the latest conversation with no socket URL and two accepted own toggles',
    should: 'render the current count and own mark from each authorized answer',
    actual: JSON.parse(stdout),
    expected: {
      calls: 2,
      labels: ['👍 2, you reacted. Remove', '👍 1. React'],
    },
  });
}, 30000);
