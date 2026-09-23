import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createVerifyReport,
  formatVerifyReport,
  isDocsOnly,
  runVerify,
  type VerifyCommand,
} from './verify';

const quiet = {
  changedFiles: async () => ['scripts/verify.ts'],
  writeLog: (stage: string) => `logs/${stage}.log`,
  print: () => undefined,
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
      given: 'docs and ADR changes, a mixed diff, and an empty diff',
      should: 'treat only the documentation diff as docs-only',
      actual: [
        isDocsOnly(['docs/decisions/0035-x.md', 'AGENTS.md']),
        isDocsOnly(['docs/development/testing.md', 'scripts/verify.ts']),
        isDocsOnly([]),
      ],
      expected: [true, false, false],
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
