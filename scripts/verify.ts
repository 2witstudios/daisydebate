import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const gateNames = [
  'check',
  'integration',
  'e2e',
  'migration-idempotency',
] as const;

export type VerifyGateName = (typeof gateNames)[number];
type VerifyStatus = 'pass' | 'fail';

export type VerifyGate = {
  readonly name: VerifyGateName;
  readonly status: VerifyStatus;
  readonly detail: string;
};

export type VerifyReport = {
  readonly ok: boolean;
  readonly gates: readonly VerifyGate[];
};

export type VerifyCommand = {
  readonly name: VerifyGateName;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

type VerifyOptions = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly run?: (command: VerifyCommand) => Promise<number>;
};

const pass = (name: VerifyGateName, detail: string): VerifyGate => ({
  name,
  status: 'pass',
  detail,
});

const fail = (name: VerifyGateName, detail: string): VerifyGate => ({
  name,
  status: 'fail',
  detail,
});

export function createVerifyReport(gates: readonly VerifyGate[]): VerifyReport {
  const byName = new Map(gates.map((gate) => [gate.name, gate]));
  const orderedGates = gateNames.map(
    (name): VerifyGate =>
      byName.get(name) ?? { name, status: 'fail', detail: 'not checked' },
  );
  return {
    ok: orderedGates.every((gate) => gate.status === 'pass'),
    gates: orderedGates,
  };
}

export function formatVerifyReport(
  report: VerifyReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  return [
    `Daisy verify: ${report.ok ? 'PASS' : 'FAIL'}`,
    ...report.gates.map(
      (gate) =>
        `${gate.status === 'pass' ? 'PASS' : 'FAIL'} ${gate.name}: ${gate.detail}`,
    ),
    '',
  ].join('\n');
}

function createEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  databaseUrl?: string,
): Readonly<Record<string, string>> | undefined {
  const values = Object.entries({
    ...environment,
    ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
  })
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .reduce<Record<string, string>>(
      (result, [key, value]) => ({ ...result, [key]: value }),
      {},
    );
  return Object.keys(values).length > 0 ? values : undefined;
}

function isTestDatabaseUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).pathname.endsWith('_test');
  } catch {
    return false;
  }
}

async function runProcess(
  command: VerifyCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const process = Bun.spawn(['bun', ...command.args], {
    cwd: root,
    env: createEnvironment(environment, command.env?.DATABASE_URL),
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return process.exited;
}

async function runCommand(
  command: VerifyCommand,
  run: (command: VerifyCommand) => Promise<number>,
): Promise<string> {
  try {
    const exitCode = await run(command);
    return exitCode === 0 ? 'completed' : `exit ${exitCode}`;
  } catch {
    return 'could not start';
  }
}

export async function runVerify({
  environment = process.env,
  run = (command) => runProcess(command, environment),
}: VerifyOptions = {}): Promise<VerifyReport> {
  const check = await runCommand(
    { name: 'check', args: ['run', 'check'] },
    run,
  );
  const integration = await runCommand(
    { name: 'integration', args: ['run', 'test:integration'] },
    run,
  );
  const e2e = await runCommand({ name: 'e2e', args: ['run', 'test:e2e'] }, run);

  const testDatabaseUrl = environment.TEST_DATABASE_URL;
  const migration = !isTestDatabaseUrl(testDatabaseUrl)
    ? [fail('migration-idempotency', 'TEST_DATABASE_URL unavailable')]
    : await (async () => {
        const command = {
          name: 'migration-idempotency' as const,
          args: ['run', 'db:migrate'],
          env: { DATABASE_URL: testDatabaseUrl },
        };
        const first = await runCommand(command, run);
        if (first !== 'completed')
          return [fail('migration-idempotency', `first migration: ${first}`)];
        const second = await runCommand(command, run);
        return [
          second === 'completed'
            ? pass('migration-idempotency', 'completed twice')
            : fail('migration-idempotency', `second migration: ${second}`),
        ];
      })();

  return createVerifyReport([
    check === 'completed' ? pass('check', check) : fail('check', check),
    integration === 'completed'
      ? pass('integration', integration)
      : fail('integration', integration),
    e2e === 'completed' ? pass('e2e', e2e) : fail('e2e', e2e),
    ...migration,
  ]);
}

if (import.meta.main) {
  const report = await runVerify();
  process.stdout.write(
    formatVerifyReport(report, process.argv.includes('--json')),
  );
  process.exitCode = report.ok ? 0 : 1;
}
