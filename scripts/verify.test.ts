import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  archiveE2eArtifacts,
  createVerifyReport,
  e2eArchiveName,
  formatVerifyReport,
  combineChanges,
  isDocsOnly,
  runLogged,
  runVerify,
  type VerifyCommand,
} from './verify';

const quiet = {
  changedFiles: async () => ['scripts/verify.ts'],
  writeLog: (stage: string) => `logs/${stage}.log`,
  print: () => undefined,
  keepE2eArtifacts: () => undefined,
};

setupRitewayBun();

describe('verify report', () => {
  test('preserves gate order and derives overall health', () => {
    const report = createVerifyReport([
      { name: 'e2e', status: 'pass', detail: 'completed' },
      { name: 'check', status: 'fail', detail: 'exit 1' },
    ]);

    assert({
      given: 'verification gates in arbitrary order with one failure',
      should: 'return an ordered report marked unhealthy',
      actual: report,
      expected: {
        ok: false,
        gates: [
          { name: 'check', status: 'fail', detail: 'exit 1' },
          { name: 'integration', status: 'fail', detail: 'not checked' },
          { name: 'e2e', status: 'pass', detail: 'completed' },
          {
            name: 'migration-idempotency',
            status: 'fail',
            detail: 'not checked',
          },
        ],
      },
    });
  });

  test('renders stable machine and human output', () => {
    const report = createVerifyReport([
      { name: 'check', status: 'pass', detail: 'completed' },
      { name: 'integration', status: 'pass', detail: 'completed' },
      { name: 'e2e', status: 'pass', detail: 'completed' },
      { name: 'migration-idempotency', status: 'pass', detail: 'completed' },
    ]);

    assert({
      given: 'a healthy verification report',
      should: 'render the same report as JSON and a stable text summary',
      actual: [
        JSON.parse(formatVerifyReport(report, true)),
        formatVerifyReport(report, false),
      ],
      expected: [
        report,
        'Daisy verify: PASS\nPASS check: completed\nPASS integration: completed\nPASS e2e: completed\nPASS migration-idempotency: completed\n',
      ],
    });
  });
});

describe('verify gates', () => {
  test('runs every gate in stable order and repeats migrations on the test database', async () => {
    const calls: Array<{
      args: readonly string[];
      env?: Record<string, string>;
    }> = [];
    const report = await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      ...quiet,
      run: async ({ args, env }) => {
        calls.push({ args, env });
        return { code: 0, output: '' };
      },
    });

    assert({
      given: 'a test database and a runner that passes every command',
      should: 'run all verification gates and both migration passes',
      actual: [
        report,
        calls.map(({ args, env }) => ({
          args,
          databaseUrl: env?.DATABASE_URL,
        })),
      ],
      expected: [
        {
          ok: true,
          gates: [
            { name: 'check', status: 'pass', detail: 'completed' },
            { name: 'integration', status: 'pass', detail: 'completed' },
            { name: 'e2e', status: 'pass', detail: 'completed' },
            {
              name: 'migration-idempotency',
              status: 'pass',
              detail: 'completed twice',
            },
          ],
        },
        [
          { args: ['run', 'check'] },
          { args: ['run', 'test:integration'] },
          { args: ['run', 'test:e2e'] },
          {
            args: ['run', 'db:migrate'],
            databaseUrl: 'postgres://localhost/daisy_test',
          },
          {
            args: ['run', 'db:migrate'],
            databaseUrl: 'postgres://localhost/daisy_test',
          },
        ],
      ],
    });
  });

  test('reports each failed gate without hiding later failures', async () => {
    const report = await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      ...quiet,
      run: async ({ args }) => ({
        code: args[1] === 'test:e2e' ? 2 : 1,
        output: '',
      }),
    });

    assert({
      given: 'commands that fail at different gates',
      should: 'report every gate as failed rather than stopping early',
      actual: report,
      expected: {
        ok: false,
        gates: [
          {
            name: 'check',
            status: 'fail',
            detail: 'exit 1; log logs/check.log',
          },
          {
            name: 'integration',
            status: 'fail',
            detail: 'exit 1; log logs/integration.log',
          },
          { name: 'e2e', status: 'fail', detail: 'exit 2; log logs/e2e.log' },
          {
            name: 'migration-idempotency',
            status: 'fail',
            detail:
              'first migration: exit 1; log logs/migration-idempotency-1.log',
          },
        ],
      },
    });
  });

  test('fails the migration gate before spawning commands without a test database', async () => {
    const calls: VerifyCommand[] = [];
    const report = await runVerify({
      environment: {},
      ...quiet,
      run: async (spec) => {
        calls.push(spec);
        return { code: 0, output: '' };
      },
    });

    assert({
      given: 'no explicit test database URL',
      should:
        'fail only migration verification without running an unsafe migration',
      actual: [report.gates[3], calls.map(({ name }) => name)],
      expected: [
        {
          name: 'migration-idempotency',
          status: 'fail',
          detail: 'TEST_DATABASE_URL unavailable',
        },
        ['check', 'integration', 'e2e'],
      ],
    });
  });
});

describe('verify e2e failure artifacts', () => {
  test("keeps a failed browser run's artifacts and names where", async () => {
    const kept: string[] = [];
    const report = await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      ...quiet,
      keepE2eArtifacts: () => {
        kept.push('e2e');
        return 'verify-logs/e2e-failures/2026-09-29T21-40-05Z-a8ee939';
      },
      run: async ({ args }) => ({
        code: args[1] === 'test:e2e' ? 1 : 0,
        output: '',
      }),
    });
    assert({
      given: 'an e2e stage that fails',
      should: 'archive its artifacts once and name the archive in the gate',
      actual: { kept, detail: report.gates[2]?.detail },
      expected: {
        kept: ['e2e'],
        detail:
          'exit 1; log logs/e2e.log; artifacts verify-logs/e2e-failures/2026-09-29T21-40-05Z-a8ee939',
      },
    });
  });

  test('keeps nothing when the browser run passes', async () => {
    const kept: string[] = [];
    await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      ...quiet,
      keepE2eArtifacts: () => {
        kept.push('e2e');
        return 'unused';
      },
      run: async () => ({ code: 0, output: '' }),
    });
    assert({
      given: 'every stage passing',
      should: 'not archive anything',
      actual: kept,
      expected: [],
    });
  });

  test('names each archive by UTC time and commit, so no later run reuses it', () => {
    assert({
      given: 'a run at 21:40:05 UTC on commit a8ee939',
      should: 'give a path-safe name that sorts by time',
      actual: e2eArchiveName(new Date('2026-09-29T21:40:05.123Z'), 'a8ee939'),
      expected: '2026-09-29T21-40-05Z-a8ee939',
    });
  });

  test('copies the whole results folder into a new archive and leaves the source', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'verify-archive-'));
    const from = join(scratch, 'test-results');
    mkdirSync(join(from, 'a-failed-test'), { recursive: true });
    writeFileSync(join(from, 'a-failed-test', 'trace.zip'), 'trace');
    writeFileSync(join(from, 'server-13050.log'), 'server log');
    const to = join(scratch, 'verify-logs', 'e2e-failures', 'run-1');
    const archived = archiveE2eArtifacts({ from, to });
    assert({
      given:
        "a results folder holding a failed test's trace and the server log",
      should: 'copy both into the archive and keep the source intact',
      actual: {
        archived,
        trace: readFileSync(join(to, 'a-failed-test', 'trace.zip'), 'utf8'),
        server: readFileSync(join(to, 'server-13050.log'), 'utf8'),
        source: readFileSync(join(from, 'server-13050.log'), 'utf8'),
      },
      expected: {
        archived: true,
        trace: 'trace',
        server: 'server log',
        source: 'server log',
      },
    });
  });

  test('archives nothing when there are no results to keep', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'verify-archive-'));
    assert({
      given: 'no results folder (the browser run never started)',
      should: 'report that nothing was archived',
      actual: archiveE2eArtifacts({
        from: join(scratch, 'missing'),
        to: join(scratch, 'archive'),
      }),
      expected: false,
    });
  });
});

describe('verify stage logs', () => {
  test('keeps every stage output in its own log and prints a failing tail', async () => {
    const logs = new Map<string, string>();
    const printed: string[] = [];
    const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join(
      '\n',
    );
    const report = await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      changedFiles: async () => ['apps/web/src/app/page.tsx'],
      run: async ({ args }) => ({
        code: args[1] === 'test:integration' ? 1 : 0,
        output: `${args[1]}\n${output}`,
      }),
      writeLog: (stage, text) => {
        logs.set(stage, text);
        return `verify-logs/${stage}.log`;
      },
      print: (text) => void printed.push(text),
    });
    const tail = printed.join('');
    assert({
      given: 'a run where integration fails with long output',
      should:
        'log every stage in full and print only the failing stage tail with its log path',
      actual: {
        stages: [...logs.keys()],
        fullOutput: logs.get('integration')?.endsWith('line 60'),
        tailHasCause: tail.includes('line 60'),
        tailIsBounded: tail.includes('line 1\n'),
        tailNamesLog: tail.includes('verify-logs/integration.log'),
        passingStagePrinted: tail.includes('test:e2e'),
        detail: report.gates[1]?.detail,
      },
      expected: {
        stages: [
          'check',
          'integration',
          'e2e',
          'migration-idempotency-1',
          'migration-idempotency-2',
        ],
        fullOutput: true,
        tailHasCause: true,
        tailIsBounded: false,
        tailNamesLog: true,
        passingStagePrinted: false,
        detail: 'exit 1; log verify-logs/integration.log',
      },
    });
  });
});

describe('verify e2e scope', () => {
  test('recognises a documentation-only diff', () => {
    assert({
      given:
        'docs and ADR changes; AGENTS.md; a skill; data under docs/; a mixed diff; an empty diff',
      should:
        'treat only Markdown under docs/ as docs-only: agent instructions, skills and data change behaviour',
      actual: [
        isDocsOnly(['docs/decisions/0035-x.md', 'docs/development/testing.md']),
        isDocsOnly(['docs/decisions/0035-x.md', 'AGENTS.md']),
        isDocsOnly(['.claude/skills/epic-pipeline/SKILL.md']),
        isDocsOnly(['docs/metrics/policy.json']),
        isDocsOnly(['docs/development/testing.md', 'scripts/verify.ts']),
        isDocsOnly([]),
      ],
      expected: [true, false, false, false, false, false],
    });
  });

  test('counts untracked files as changed, and fails closed without git', () => {
    assert({
      given:
        'committed, working and untracked changes, then a git command that failed',
      should: 'return every changed file once, then nothing so e2e runs',
      actual: [
        combineChanges(['docs/a.md'], ['docs/a.md'], ['scripts/new.ts']),
        combineChanges(['docs/a.md'], undefined, []),
      ],
      expected: [['docs/a.md', 'scripts/new.ts'], []],
    });
  });

  test('skips browser e2e for a docs-only diff and says so', async () => {
    const calls: string[] = [];
    const report = await runVerify({
      environment: { TEST_DATABASE_URL: 'postgres://localhost/daisy_test' },
      ...quiet,
      changedFiles: async () => ['docs/decisions/0035-x.md'],
      run: async ({ args }) => {
        calls.push(args[1] ?? '');
        return { code: 0, output: '' };
      },
    });
    assert({
      given: 'a diff touching only an ADR',
      should: 'not run test:e2e and report the skip',
      actual: [calls.includes('test:e2e'), report.gates[2], report.ok],
      expected: [
        false,
        {
          name: 'e2e',
          status: 'skip',
          detail: 'skipped: documentation-only diff (1 file)',
        },
        true,
      ],
    });
  });
});

describe('stage logs', () => {
  test('streams stdout and stderr into the log as they are written, interleaved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grd-6-verify-log-'));
    const logPath = join(dir, 'stage.log');
    const result = await runLogged(
      ['sh', '-c', 'echo out1; echo err >&2; echo out2; exit 3'],
      { cwd: dir, env: {}, logPath },
    );
    assert({
      given: 'a stage writing to stdout, then stderr, then stdout, and failing',
      should:
        'keep the exit code and write both streams to the log in the order written',
      actual: [result, readFileSync(logPath, 'utf8')],
      expected: [{ code: 3, output: 'out1\nerr\nout2\n' }, 'out1\nerr\nout2\n'],
    });
  });
});
