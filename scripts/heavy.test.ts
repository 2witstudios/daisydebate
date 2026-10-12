import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  admission,
  ancestors,
  claimFile,
  formatDuration,
  overdue,
  OVERDUE_GRACE_MS,
  overdueLine,
  processTree,
  claimPlan,
  HEAVY_ENV,
  keepsClaim,
  lockDir,
  nestedIn,
  parseHeld,
  parseProcessTable,
  readLimit,
  readTimeoutMs,
  slotFile,
  timeoutLine,
  unqueued,
  waitingLine,
} from './heavy';

setupRitewayBun();

/** A claim started at 0 with a deadline at 1000. */
const h = (slot: number, pid: number) => ({
  slot,
  pid,
  start: 0,
  deadline: 1000,
});

describe('claimPlan', () => {
  test('claims a free slot under the limit and clears slots of dead runs', () => {
    assert({
      given: 'slot 0 held by a live run, slot 1 by a dead one, limit 2',
      should: 'clear the dead run by its own pid and claim slot 1',
      actual: claimPlan([h(0, 10), h(1, 11)], 2, (pid) => pid === 10),
      expected: { claim: 1, stale: [h(1, 11)] },
    });
  });

  test('queues when every slot is held by a live run', () => {
    assert({
      given: 'two live runs and a limit of 2',
      should: 'claim nothing',
      actual: claimPlan([h(0, 10), h(1, 11)], 2, () => true),
      expected: { claim: undefined, stale: [] },
    });
  });
});

describe('claimPlan counts every live run', () => {
  test('queues when the live claims reach the limit, whichever slots they hold', () => {
    assert({
      given: 'live claims on slots 1 and 2 and a limit of 1, then of 3',
      should: 'claim nothing at 1, and slot 0 at 3',
      actual: [
        claimPlan([h(1, 10), h(2, 11)], 1, () => true).claim,
        claimPlan([h(1, 10), h(2, 11)], 3, () => true).claim,
      ],
      expected: [undefined, 0],
    });
  });
});

describe('claims named by pid', () => {
  test('reads slot, pid, start and deadline from the file name, never from its content', () => {
    const claim = { slot: 1, pid: 77, start: 1000, deadline: 2_701_000 };
    assert({
      given: 'a written claim name, a name without a deadline, and other files',
      should: 'round-trip the written claim and ignore the rest',
      actual: parseHeld([
        slotFile(claim),
        'slot-0-4242.pid',
        'slot-0.pid',
        '.DS_Store',
      ]),
      expected: [claim],
    });
  });

  test('keeps a claim only while no other live run holds the same slot', () => {
    const mine = h(0, 20);
    assert({
      given:
        'my claim alone, beside a live rival on slot 0, beside a dead rival, and beside a live run on slot 1',
      should:
        'keep it, withdraw it, keep it, keep it, and withdraw when the live claims exceed the limit',
      actual: [
        keepsClaim([mine], mine, () => true, 2),
        keepsClaim([h(0, 10), mine], mine, () => true, 2),
        keepsClaim([h(0, 10), mine], mine, (pid) => pid === 20, 2),
        keepsClaim([h(1, 10), mine], mine, () => true, 2),
        // Two racers on different slots at a limit of 1 both withdraw.
        keepsClaim([h(1, 10), mine], mine, () => true, 1),
      ],
      expected: [true, false, true, true, false],
    });
  });
});

describe('claimFile', () => {
  test('never writes through a file or symlink already at the claim name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grd-6-claim-'));
    const target = join(dir, 'owner-file');
    writeFileSync(target, 'keep');
    symlinkSync(target, join(dir, 'slot-0-1.pid'));
    writeFileSync(join(dir, 'slot-1-1.pid'), 'other run');
    assert({
      given:
        'a symlink planted at one claim name, a file at another, and a free name',
      should:
        'refuse the first two, leave both targets intact, and claim the free one',
      actual: [
        claimFile(join(dir, 'slot-0-1.pid')),
        claimFile(join(dir, 'slot-1-1.pid')),
        readFileSync(target, 'utf8'),
        readFileSync(join(dir, 'slot-1-1.pid'), 'utf8'),
        claimFile(join(dir, 'slot-2-1.pid')),
      ],
      expected: [false, false, 'keep', 'other run', true],
    });
  });
});

describe('nested runs', () => {
  const table = parseProcessTable(
    [
      '  PID  PPID',
      '    1     0',
      '  100     1',
      '  200   100',
      '  300   200',
      '  400     1',
      '',
    ].join('\n'),
  );

  test('reads ancestry from the process table, nearest first', () => {
    assert({
      given:
        'a process three levels below init, a sibling tree, and an unknown pid',
      should:
        'list its ancestors up to init, the sibling only init, and nothing',
      actual: [
        ancestors(table, 300),
        ancestors(table, 400),
        ancestors(table, 999),
      ],
      expected: [[200, 100, 1], [1], []],
    });
  });

  test('stops at a cycle in the process table', () => {
    assert({
      given: 'two pids that name each other as parent',
      should: 'list the other once and stop',
      actual: ancestors(
        new Map([
          [5, 6],
          [6, 5],
        ]),
        5,
      ),
      expected: [6, 5],
    });
  });

  test('runs inside a live ancestor claim instead of claiming', () => {
    const held = [h(0, 100)];
    assert({
      given:
        'a claim held by a live ancestor, by a dead ancestor, and by a live run outside the lineage',
      should: 'nest in the first, and claim normally in the other two',
      actual: [
        nestedIn(held, ancestors(table, 300), () => true),
        nestedIn(held, ancestors(table, 300), (pid) => pid !== 100),
        nestedIn(held, ancestors(table, 400), () => true),
      ],
      expected: [h(0, 100), undefined, undefined],
    });
  });
  test('never queues a holder descendant behind its own slot', () => {
    // The 2026-10-12 deadlock: a wrapper held the only slot of the pool and
    // the e2e run it started, pointed at the same pool, queued behind it.
    const held = [h(0, 100)];
    assert({
      given:
        'the only slot (limit 1) held by the ancestor of a run in the same pool, and by an unrelated run',
      should:
        'admit the descendant inside that slot, and queue the unrelated run',
      actual: [
        admission(held, ancestors(table, 300), 1, () => true),
        admission(held, ancestors(table, 400), 1, () => true),
        admission([], ancestors(table, 400), 1, () => true),
      ],
      expected: [
        { kind: 'nested', holder: h(0, 100) },
        { kind: 'wait' },
        { kind: 'claim', slot: 0 },
      ],
    });
  });

  test("lists a holder's whole process tree, holder first", () => {
    assert({
      given: 'the process table and a holder at pid 100',
      should: 'list 100 and every process below it, but not its sibling 400',
      actual: processTree(table, 100),
      expected: [100, 200, 300],
    });
  });
});

describe('wall-clock limit', () => {
  test('reads DAISY_HEAVY_TIMEOUT_MINUTES and defaults to 45 minutes', () => {
    assert({
      given: 'a set value, a fraction, nothing, and nonsense',
      should: 'use the value, the fraction, then the default twice',
      actual: [
        readTimeoutMs({ DAISY_HEAVY_TIMEOUT_MINUTES: '90' }),
        readTimeoutMs({ DAISY_HEAVY_TIMEOUT_MINUTES: '0.5' }),
        readTimeoutMs({}),
        readTimeoutMs({ DAISY_HEAVY_TIMEOUT_MINUTES: '-1' }),
      ],
      expected: [5_400_000, 30_000, 2_700_000, 2_700_000],
    });
  });

  test('ends a live holder only once its own deadline is a grace past', () => {
    const held = [
      h(0, 10),
      { slot: 1, pid: 11, start: 0, deadline: 5000 },
      h(2, 12),
    ];
    const now = 1000 + OVERDUE_GRACE_MS + 1;
    assert({
      given:
        'a live holder past deadline and grace, a live holder with a later deadline, and a dead holder past it',
      should: 'mark only the first overdue',
      actual: overdue(held, now, (pid) => pid !== 12),
      expected: [h(0, 10)],
    });
  });

  test('keeps a holder at its deadline within the grace', () => {
    assert({
      given: 'a live holder exactly at deadline plus grace',
      should: 'leave it running',
      actual: overdue([h(0, 10)], 1000 + OVERDUE_GRACE_MS, () => true),
      expected: [],
    });
  });

  test('formats durations as the two largest units', () => {
    assert({
      given:
        'nothing, seconds, minutes and seconds, hours and minutes, and a negative',
      should: 'read 0s, 5s, 3m 5s, 2h 54m and 0s',
      actual: [0, 5000, 185_000, 10_440_000, -3000].map(formatDuration),
      expected: ['0s', '5s', '3m 5s', '2h 54m', '0s'],
    });
  });

  test('says what was terminated and why', () => {
    assert({
      given:
        'a dev server past a 45 minute limit, and a hung holder found overdue',
      should: 'name the command, the limit, and that the slot was released',
      actual: [
        timeoutLine('bun dev:agent', 2_700_000),
        overdueLine(h(0, 4242), 'bun run typecheck', 1000 + 3_600_000),
      ],
      expected: [
        'heavy: "bun dev:agent" ran past its 45m wall-clock limit (DAISY_HEAVY_TIMEOUT_MINUTES); terminated its process tree and released the slot\n',
        'heavy: pid 4242 (bun run typecheck) ran 1h past its deadline; terminated its process tree and released slot 0\n',
      ],
    });
  });
});

describe('unqueued', () => {
  test('strips the queue prefix and any leading env assignment', () => {
    assert({
      given: 'a root, a web, an env-prefixed web, and an unqueued script',
      should: 'return each command without the queue',
      actual: [
        unqueued("bun scripts/heavy.ts sh -c 'bun test scripts'"),
        unqueued('bun ../../scripts/heavy.ts bun test src scripts'),
        unqueued(
          'NODE_ENV=production bun ../../scripts/heavy.ts bun --bun next build',
        ),
        unqueued('bun test src'),
      ],
      expected: [
        "sh -c 'bun test scripts'",
        'bun test src scripts',
        'bun --bun next build',
        'bun test src',
      ],
    });
  });
});

describe('waitingLine', () => {
  test('names the live holders it waits for', () => {
    assert({
      given: 'one live holder and one dead claim under a limit of 1',
      should: 'name the live holder pid, its command, its age and time left',
      actual: waitingLine(
        [{ slot: 0, pid: 4242, start: 0, deadline: 2_700_000 }, h(1, 77)],
        (pid) => pid === 4242,
        1,
        10_445_000,
        (pid) => (pid === 4242 ? 'bun run typecheck' : 'other'),
      ),
      expected:
        'heavy: waiting for pid 4242 (bun run typecheck, running 2h 54m, ends in 0s) (DAISY_HEAVY_CONCURRENCY=1)\n',
    });
  });
});

describe('readLimit', () => {
  test('reads a positive DAISY_HEAVY_CONCURRENCY and defaults to 1', () => {
    assert({
      given: 'a set value, nothing, and nonsense',
      should: 'use the value, then the default twice',
      actual: [
        readLimit({ DAISY_HEAVY_CONCURRENCY: '3' }),
        readLimit({}),
        readLimit({ DAISY_HEAVY_CONCURRENCY: '0' }),
      ],
      expected: [3, 1, 1],
    });
  });
});

describe('one machine-wide pool', () => {
  test('uses one fixed lock directory whatever TMPDIR says', () => {
    assert({
      given: 'two TMPDIRs, and an explicit DAISY_HEAVY_LOCK_DIR',
      should:
        'use /tmp/daisy-heavy-slots for both, and the explicit one when set',
      actual: [
        lockDir({ TMPDIR: '/var/folders/xy/T/' }),
        lockDir({ TMPDIR: '/tmp' }),
        lockDir({ DAISY_HEAVY_LOCK_DIR: '/srv/heavy', TMPDIR: '/tmp' }),
      ],
      expected: [
        '/tmp/daisy-heavy-slots',
        '/tmp/daisy-heavy-slots',
        '/srv/heavy',
      ],
    });
  });

  test('passes the limit settings through turbo to every task', async () => {
    const turbo = (await Bun.file(
      new URL('../turbo.json', import.meta.url),
    ).json()) as { globalPassThroughEnv?: string[] };
    assert({
      given: "turbo's strict env mode",
      should: 'pass every DAISY_HEAVY_* setting through globally',
      actual: HEAVY_ENV.every((name) =>
        turbo.globalPassThroughEnv?.includes(name),
      ),
      expected: true,
    });
  });

  test('queues every heavy root and web script', async () => {
    const scripts = async (path: string) =>
      (
        (await Bun.file(new URL(path, import.meta.url)).json()) as {
          scripts: Record<string, string>;
        }
      ).scripts;
    const root = await scripts('../package.json');
    const web = await scripts('../apps/web/package.json');
    const queued = (command: string | undefined) =>
      command !== undefined && unqueued(command) !== command;
    assert({
      given: 'the root and apps/web package scripts',
      should: 'start each heavy one through the queue',
      actual: {
        root: [
          'build',
          'typecheck',
          'lint',
          'test',
          'test:integration',
          'test:e2e',
          'check',
          'check:affected',
          'verify',
          'dev',
          'dev:agent',
          'knip',
          'duplication',
        ].filter((name) => !queued(root[name])),
        web: ['dev', 'build', 'typecheck', 'test', 'test:e2e'].filter(
          (name) => !queued(web[name]),
        ),
      },
      expected: { root: [], web: [] },
    });
  });
});

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
