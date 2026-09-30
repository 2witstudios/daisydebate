#!/usr/bin/env bun
/**
 * Runs a workspace's integration suites, discovered by folder and suffix
 * (`integration/**` + `*.integration.ts`) instead of
 * a hand-kept list in package.json. Bun's runner does not match the
 * `.integration.ts` suffix from a directory argument, so the files are
 * globbed here and passed explicitly. `bun evidence` treats this runner as
 * claiming every suite in the workspace's integration folder.
 */
import { constants } from 'node:os';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';

export const INTEGRATION_RUNNER = 'bun ../../scripts/test-integration.ts';

const SUITE = /(?:^|\/)integration\/(?:.+\/)?[^/]+\.integration\.tsx?$/;

export const integrationSuites = (files: readonly string[]): string[] =>
  files.filter((file) => SUITE.test(file)).sort();

/** The integration suites under a workspace directory, .ts and .tsx. */
export const discoverSuites = (cwd: string): string[] =>
  integrationSuites([
    ...new Bun.Glob('integration/**/*.{ts,tsx}').scanSync(cwd),
  ]);

/**
 * The exit code for a finished run. A run killed by a signal has no exit
 * code, and exiting with none would report success; it exits 128 + the
 * signal number, as a shell does.
 */
export function exitCodeOf(result: {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
}): number {
  if (result.exitCode !== null) return result.exitCode;
  const signal =
    constants.signals[
      (result.signalCode ?? '') as keyof typeof constants.signals
    ];
  return signal === undefined ? 1 : 128 + signal;
}

// A repository path the runner reaches: <apps|packages>/<name>/integration/….
const RUNNER_SUITE =
  /^[^/]+\/[^/]+\/integration\/(?:.+\/)?[^/]+\.integration\.tsx?$/;

/**
 * Whether a workspace's test:integration script runs this suite, given its
 * repository path. The runner scans only the workspace's own integration/
 * folder, so a nested src/…/integration/ suite is not claimed.
 */
export function claimsIntegrationSuite(script: string, file: string): boolean {
  return script === INTEGRATION_RUNNER
    ? RUNNER_SUITE.test(file)
    : script.includes(file.split('/').pop() ?? file);
}

type RowCounts = Readonly<Record<string, number>>;

/**
 * ISSUE-192: every table a run left with more rows than it started with.
 * Suites remove exactly what they create, so a table that grew is a leak:
 * leaked rows accumulate run over run and slow every later run.
 */
export const grownTables = (before: RowCounts, after: RowCounts) =>
  Object.entries(after)
    .filter(([table, rows]) => rows > (before[table] ?? 0))
    .map(([table, rows]) => ({
      table,
      before: before[table] ?? 0,
      after: rows,
    }))
    .sort((a, b) => a.table.localeCompare(b.table));

/** Exact row counts of every public table in the test database. */
async function rowCounts(databaseUrl: string): Promise<RowCounts> {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const tables = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`) as Array<{
      table_name: string;
    }>;
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const [row] = (await sql.unsafe(
        `SELECT count(*)::int AS rows FROM "${table}"`,
      )) as Array<{ rows: number }>;
      counts[table] = row?.rows ?? 0;
    }
    return counts;
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  const files = discoverSuites('.');
  if (files.length === 0) {
    process.stderr.write('test-integration: no suites under integration/\n');
    process.exit(1);
  }
  const { databaseUrl } = requireTestServices(process.env);
  const before = await rowCounts(databaseUrl);
  const child = Bun.spawnSync(
    [
      'bun',
      'test',
      ...files.map((file) => `./${file}`),
      ...process.argv.slice(2),
    ],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  );
  const grown = grownTables(before, await rowCounts(databaseUrl));
  for (const { table, before: from, after: to } of grown)
    process.stderr.write(
      `test-integration: ${table} grew from ${from} to ${to} rows; a suite left rows behind (ISSUE-192)\n`,
    );
  process.exit(exitCodeOf(child) || (grown.length > 0 ? 1 : 0));
}
