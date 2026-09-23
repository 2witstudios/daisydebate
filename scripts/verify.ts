import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const gateNames = [
  'check',
  'integration',
  'e2e',
  'migration-idempotency',
] as const;

export type VerifyGateName = (typeof gateNames)[number];
type VerifyStatus = 'pass' | 'fail' | 'skip';

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

type StageResult = { readonly code: number; readonly output: string };

type VerifyOptions = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly run?: (command: VerifyCommand) => Promise<StageResult>;
  /** Files this branch changes, for scoping browser e2e. */
  readonly changedFiles?: () => Promise<readonly string[]>;
  /** Stores one stage's full output; returns where it was kept. */
  readonly writeLog?: (stage: string, output: string) => string;
  readonly print?: (text: string) => void;
};

const TAIL_LINES = 40;
const LOG_DIR = 'verify-logs';

/** A diff that touches only documentation: Markdown, ADRs included. */
export function isDocsOnly(files: readonly string[]): boolean {
  return (
    files.length > 0 &&
    files.every((file) => file.startsWith('docs/') || file.endsWith('.md'))
  );
}

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
    ok: orderedGates.every((gate) => gate.status !== 'fail'),
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
      (gate) => `${gate.status.toUpperCase()} ${gate.name}: ${gate.detail}`,
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
): Promise<StageResult> {
  const child = Bun.spawn(['bun', ...command.args], {
    cwd: root,
    env: createEnvironment(environment, command.env?.DATABASE_URL),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
}

function writeStageLog(stage: string, output: string): string {
  mkdirSync(join(root, LOG_DIR), { recursive: true });
  const path = join(root, LOG_DIR, `${stage}.log`);
  writeFileSync(path, output);
  return relative(root, path);
}

async function gitChangedFiles(): Promise<readonly string[]> {
  const lines = async (args: readonly string[]) => {
    const child = Bun.spawn(['git', ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const text = await new Response(child.stdout).text();
    return (await child.exited) === 0
      ? text.split('\n').filter(Boolean)
      : undefined;
  };
  const committed = await lines(['diff', '--name-only', 'origin/main...HEAD']);
  const working = await lines(['diff', '--name-only', 'HEAD']);
  // Without a base to compare against, assume the diff touches code.
  return committed && working ? [...new Set([...committed, ...working])] : [];
}

type Stage = {
  readonly run: (command: VerifyCommand) => Promise<StageResult>;
  readonly writeLog: (stage: string, output: string) => string;
  readonly print: (text: string) => void;
};

async function runCommand(
  command: VerifyCommand,
  stage: Stage,
  logName: string = command.name,
): Promise<string> {
  let result: StageResult;
  try {
    result = await stage.run(command);
  } catch (error) {
    result = { code: -1, output: String(error) };
  }
  const log = stage.writeLog(logName, result.output);
  if (result.code === 0) return 'completed';
  const tail = result.output.split('\n').slice(-TAIL_LINES).join('\n');
  stage.print(
    `--- ${logName} failed (exit ${result.code}); last ${TAIL_LINES} lines, full log ${log}\n${tail}\n`,
  );
  return `exit ${result.code}; log ${log}`;
}

async function migrationGate(
  testDatabaseUrl: string | undefined,
  stage: Stage,
): Promise<VerifyGate> {
  if (!isTestDatabaseUrl(testDatabaseUrl))
    return fail('migration-idempotency', 'TEST_DATABASE_URL unavailable');
  const command = {
    name: 'migration-idempotency' as const,
    args: ['run', 'db:migrate'],
    env: { DATABASE_URL: testDatabaseUrl },
  };
  const first = await runCommand(command, stage, `${command.name}-1`);
  if (first !== 'completed')
    return fail('migration-idempotency', `first migration: ${first}`);
  const second = await runCommand(command, stage, `${command.name}-2`);
  return second === 'completed'
    ? pass('migration-idempotency', 'completed twice')
    : fail('migration-idempotency', `second migration: ${second}`);
}

const gate = (name: VerifyGateName, detail: string): VerifyGate =>
  detail === 'completed' ? pass(name, detail) : fail(name, detail);

export async function runVerify({
  environment = process.env,
  run = (command) => runProcess(command, environment),
  changedFiles = gitChangedFiles,
  writeLog = writeStageLog,
  print = (text) => void process.stderr.write(text),
}: VerifyOptions = {}): Promise<VerifyReport> {
  const stage: Stage = { run, writeLog, print };
  const check = await runCommand(
    { name: 'check', args: ['run', 'check'] },
    stage,
  );
  const integration = await runCommand(
    { name: 'integration', args: ['run', 'test:integration'] },
    stage,
  );
  const files = await changedFiles();
  const e2e = isDocsOnly(files)
    ? {
        name: 'e2e' as const,
        status: 'skip' as const,
        detail: `skipped: documentation-only diff (${files.length} file${files.length === 1 ? '' : 's'})`,
      }
    : gate(
        'e2e',
        await runCommand({ name: 'e2e', args: ['run', 'test:e2e'] }, stage),
      );
  return createVerifyReport([
    gate('check', check),
    gate('integration', integration),
    e2e,
    await migrationGate(environment.TEST_DATABASE_URL, stage),
  ]);
}

if (import.meta.main) {
  const report = await runVerify();
  process.stdout.write(
    formatVerifyReport(report, process.argv.includes('--json')),
  );
  process.exitCode = report.ok ? 0 : 1;
}
