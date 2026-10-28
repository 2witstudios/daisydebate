import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
requireTestServices(process.env);

const FRAMES = 5;
const PROCESS_DEADLINE_MS = 10_000;

/**
 * Closes one native publication in `order`, in a child process: native
 * rtc-node state from a room the server deleted never lives on in this
 * runner, where it once crashed Bun in a later suite (ISSUE-789).
 */
async function closeIn(order: 'racing' | 'dropped' | 'live') {
  const child = Bun.spawn(
    ['bun', 'audio-publication-room-ended-process.ts', order],
    {
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: PROCESS_DEADLINE_MS,
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(
      `Publication process exited ${exitCode}: ${stderr.slice(0, 500)}`,
    );
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as unknown;
}

test(
  'a native publication closes when its room is deleted, before the drop arrives (ISSUE-789)',
  async () => {
    assert({
      given: 'Round cleanup deleting the room, with close racing the drop',
      should: 'close without a refusal and report the samples it sent',
      actual: ((await closeIn('racing')) as { consumedSamples: number })
        .consumedSamples,
      expected: FRAMES * 240,
    });
  },
  PROCESS_DEADLINE_MS + 2_000,
);

test(
  'a native publication closes after its deleted room dropped it (ISSUE-789)',
  async () => {
    assert({
      given: 'a bot publication the server already disconnected',
      should: 'close without a refusal and report the samples it sent',
      actual: await closeIn('dropped'),
      expected: { usable: false, consumedSamples: FRAMES * 240 },
    });
  },
  PROCESS_DEADLINE_MS + 2_000,
);

test(
  'a native publication in a live room closes',
  async () => {
    assert({
      given: 'a bot publication whose room is still open',
      should: 'close and report the samples it sent',
      actual: await closeIn('live'),
      expected: { usable: true, consumedSamples: FRAMES * 240 },
    });
  },
  PROCESS_DEADLINE_MS + 2_000,
);
