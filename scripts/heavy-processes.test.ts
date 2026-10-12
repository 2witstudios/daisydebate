import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

describe('heavy queue across real processes', () => {
  const root = new URL('..', import.meta.url).pathname;

  async function runConcurrently(limit: number): Promise<[number, number][]> {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-limit-'));
    const log = join(dir, 'log');
    const job = `const s=Date.now(); await Bun.sleep(300); require('node:fs').appendFileSync(${JSON.stringify(log)}, s + ' ' + Date.now() + '\\n');`;
    const runs = Array.from({ length: 3 }, () =>
      Bun.spawn(['bun', `${root}scripts/heavy.ts`, 'bun', '-e', job], {
        env: {
          ...process.env,
          DAISY_HEAVY_CONCURRENCY: String(limit),
          DAISY_HEAVY_LOCK_DIR: join(dir, 'slots'),
          DAISY_HEAVY_POLL_MS: '25',
        },
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    );
    const codes = await Promise.all(runs.map((run) => run.exited));
    if (codes.some((code) => code !== 0)) throw new Error(`exit ${codes}`);
    return readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(' ').map(Number) as [number, number])
      .sort(([a], [b]) => a - b);
  }

  const overlaps = (runs: [number, number][]) =>
    runs.some(
      ([, end], index) => index + 1 < runs.length && runs[index + 1][0] < end,
    );

  test('queues runs beyond the limit instead of running them at once', async () => {
    assert({
      given: 'three concurrent runs under a limit of 1, then of 3',
      should: 'serialise them at 1 and overlap them at 3',
      actual: [
        overlaps(await runConcurrently(1)),
        overlaps(await runConcurrently(3)),
      ],
      expected: [false, true],
    });
  });

  test('runs a nested heavy command inside the slot its ancestor holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-nested-'));
    const out = join(dir, 'out');
    const heavy = `${root}scripts/heavy.ts`;
    const write = `require('node:fs').writeFileSync(${JSON.stringify(out)}, 'ran')`;
    const outer = Bun.spawn(
      ['bun', heavy, 'bun', heavy, 'bun', heavy, 'bun', '-e', write],
      {
        env: {
          ...process.env,
          DAISY_HEAVY_CONCURRENCY: '1',
          DAISY_HEAVY_LOCK_DIR: join(dir, 'slots'),
          DAISY_HEAVY_POLL_MS: '25',
        },
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
    const deadline = setTimeout(() => outer.kill(), 15_000);
    const code = await outer.exited;
    clearTimeout(deadline);
    assert({
      given: 'a run that holds the only slot and starts two nested runs',
      should: 'run the innermost command without queueing and exit 0',
      actual: {
        code,
        out: readFileSync(out, 'utf8'),
        stderr: await new Response(outer.stderr).text(),
      },
      expected: { code: 0, out: 'ran', stderr: '' },
    });
  });

  test('terminates a run past its wall-clock limit and releases the slot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-timeout-'));
    const slots = join(dir, 'slots');
    const started = Date.now();
    const runner = Bun.spawn(
      ['bun', `${root}scripts/heavy.ts`, 'sh', '-c', 'sleep 30; echo late'],
      {
        env: {
          ...process.env,
          DAISY_HEAVY_LOCK_DIR: slots,
          DAISY_HEAVY_POLL_MS: '25',
          DAISY_HEAVY_TIMEOUT_MINUTES: '0.01',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const code = await runner.exited;
    assert({
      given: 'a command that sleeps 30 s under a 0.6 s limit',
      should:
        'end it with exit 124 well before 30 s, never print its output, say why, and leave no claim',
      actual: {
        code,
        early: Date.now() - started < 15_000,
        stdout: await new Response(runner.stdout).text(),
        said: (await new Response(runner.stderr).text()).includes(
          'wall-clock limit',
        ),
        claims: readdirSync(slots),
      },
      expected: { code: 124, early: true, stdout: '', said: true, claims: [] },
    });
  });
});
