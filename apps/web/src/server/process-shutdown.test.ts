import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const child = join(import.meta.dir, 'process-shutdown-child.test-support.ts');

/** Starts the child, sends SIGTERM once it listens, and reads every line it printed. */
const shutDown = async (...args: string[]) => {
  const proc = Bun.spawn(['bun', child, ...args], { stdout: 'pipe' });
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (text.includes('ready\n') && !text.includes('drain')) {
      proc.kill('SIGTERM');
    }
  }
  return { lines: text.trim().split('\n'), code: await proc.exited };
};

const at = (lines: readonly string[], line: string) => lines.indexOf(line);
const allAt = (lines: readonly string[], prefix: string) =>
  lines.flatMap((line, index) => (line.startsWith(prefix) ? [index] : []));

describe('the production shutdown in a real process', () => {
  test('stops every worker before the drain and awaits them before the pools close', async () => {
    const { lines, code } = await shutDown();
    const called = allAt(lines, 'stop called');
    const settled = allAt(lines, 'stop settled');
    assert({
      given: 'SIGTERM to a process with three background workers',
      should:
        'call every stop before the drain begins, await every stop after the server closes, close the app last and exit 0',
      actual: {
        code,
        called: called.length,
        settled: settled.length,
        stopsBeforeDrain:
          Math.max(...called) < at(lines, 'log server.shutdown'),
        serverBeforeApp:
          at(lines, 'server closed') < at(lines, 'app closed') &&
          at(lines, 'next closed') < at(lines, 'app closed'),
        stopsAwaitedBeforeApp: Math.max(...settled) < at(lines, 'app closed'),
        last: lines.at(-1),
      },
      expected: {
        code: 0,
        called: 3,
        settled: 3,
        stopsBeforeDrain: true,
        serverBeforeApp: true,
        stopsAwaitedBeforeApp: true,
        last: 'app closed',
      },
    });
  });

  test('the drain deadline still forces the exit', async () => {
    const { lines, code } = await shutDown('stall');
    assert({
      given: 'a close that never finishes',
      should:
        'report the unfinished work, never close the app and exit 1 at the deadline',
      actual: {
        code,
        reported: lines.includes('unfinished work reported'),
        appClosed: lines.includes('app closed'),
        last: lines.at(-1),
      },
      expected: {
        code: 1,
        reported: true,
        appClosed: false,
        last: 'exit 1',
      },
    });
  });

  test('a worker stop that outlasts the deadline never closes the app under it', async () => {
    const { lines, code } = await shutDown('stall-stop');
    assert({
      given: 'a worker whose stop is still running at the drain deadline',
      should:
        'leave the app open, report the unfinished work and exit 1 at the deadline',
      actual: {
        code,
        reported: lines.includes('unfinished work reported'),
        appClosed: lines.includes('app closed'),
        slowSettled: lines.includes('stop settled slow'),
        last: lines.at(-1),
      },
      expected: {
        code: 1,
        reported: true,
        appClosed: false,
        slowSettled: false,
        last: 'exit 1',
      },
    });
  });
});
