import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createVerifyReport,
  formatVerifyReport,
  runVerify,
  type VerifyCommand,
} from './verify';

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
      run: async ({ args, env }) => {
        calls.push({ args, env });
        return 0;
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
      run: async ({ args }) => (args[1] === 'test:e2e' ? 2 : 1),
    });

    assert({
      given: 'commands that fail at different gates',
      should: 'report every gate as failed rather than stopping early',
      actual: report,
      expected: {
        ok: false,
        gates: [
          { name: 'check', status: 'fail', detail: 'exit 1' },
          { name: 'integration', status: 'fail', detail: 'exit 1' },
          { name: 'e2e', status: 'fail', detail: 'exit 2' },
          {
            name: 'migration-idempotency',
            status: 'fail',
            detail: 'first migration: exit 1',
          },
        ],
      },
    });
  });

  test('fails the migration gate before spawning commands without a test database', async () => {
    const calls: VerifyCommand[] = [];
    const report = await runVerify({
      environment: {},
      run: async (spec) => {
        calls.push(spec);
        return 0;
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
