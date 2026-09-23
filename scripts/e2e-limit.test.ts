import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { claimPlan, readLimit } from './e2e-limit';

setupRitewayBun();

describe('claimPlan', () => {
  test('claims a free slot under the limit and clears slots of dead runs', () => {
    assert({
      given: 'slot 0 held by a live run, slot 1 by a dead one, limit 2',
      should: 'clear slot 1 and claim it',
      actual: claimPlan(
        [
          { slot: 0, pid: 10 },
          { slot: 1, pid: 11 },
        ],
        2,
        (pid) => pid === 10,
      ),
      expected: { claim: 1, stale: [1] },
    });
  });

  test('queues when every slot is held by a live run', () => {
    assert({
      given: 'two live runs and a limit of 2',
      should: 'claim nothing',
      actual: claimPlan(
        [
          { slot: 0, pid: 10 },
          { slot: 1, pid: 11 },
        ],
        2,
        () => true,
      ),
      expected: { claim: undefined, stale: [] },
    });
  });
});

describe('readLimit', () => {
  test('reads a positive DAISY_E2E_CONCURRENCY and defaults to 2', () => {
    assert({
      given: 'a set value, nothing, and nonsense',
      should: 'use the value, then the default twice',
      actual: [
        readLimit({ DAISY_E2E_CONCURRENCY: '3' }),
        readLimit({}),
        readLimit({ DAISY_E2E_CONCURRENCY: '0' }),
      ],
      expected: [3, 2, 2],
    });
  });
});

describe('e2e limit across real processes', () => {
  const root = new URL('..', import.meta.url).pathname;

  async function runConcurrently(limit: number): Promise<[number, number][]> {
    const dir = mkdtempSync(join(tmpdir(), 'grd-6-e2e-limit-'));
    const log = join(dir, 'log');
    const job = `const s=Date.now(); await Bun.sleep(300); require('node:fs').appendFileSync(${JSON.stringify(log)}, s + ' ' + Date.now() + '\\n');`;
    const runs = Array.from({ length: 3 }, () =>
      Bun.spawn(['bun', `${root}scripts/e2e-limit.ts`, 'bun', '-e', job], {
        env: {
          ...process.env,
          DAISY_E2E_CONCURRENCY: String(limit),
          DAISY_E2E_LOCK_DIR: join(dir, 'slots'),
          DAISY_E2E_POLL_MS: '25',
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
});
