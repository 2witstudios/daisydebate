#!/usr/bin/env bun
/**
 * Runs a workspace's integration suites, discovered by folder and suffix
 * (`integration/**` + `*.integration.ts`, `*.integration.test.ts`) instead of
 * a hand-kept list in package.json. Bun's runner does not match the
 * `.integration.ts` suffix from a directory argument, so the files are
 * globbed here and passed explicitly. `bun evidence` treats this runner as
 * claiming every suite in the workspace's integration folder.
 */
import { constants } from 'node:os';

export const INTEGRATION_RUNNER = 'bun ../../scripts/test-integration.ts';

const SUITE =
  /(?:^|\/)integration\/(?:.+\/)?[^/]+\.integration(?:\.test)?\.tsx?$/;

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

/** Whether a workspace's test:integration script runs this suite. */
export function claimsIntegrationSuite(script: string, file: string): boolean {
  return script === INTEGRATION_RUNNER
    ? SUITE.test(file)
    : script.includes(file.split('/').pop() ?? file);
}

if (import.meta.main) {
  const files = discoverSuites('.');
  if (files.length === 0) {
    process.stderr.write('test-integration: no suites under integration/\n');
    process.exit(1);
  }
  const child = Bun.spawnSync(
    [
      'bun',
      'test',
      ...files.map((file) => `./${file}`),
      ...process.argv.slice(2),
    ],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  );
  process.exit(exitCodeOf(child));
}
