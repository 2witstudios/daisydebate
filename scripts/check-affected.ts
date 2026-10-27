import { existsSync } from 'node:fs';
import turboConfig from '../turbo.json';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

export type AffectedPlan = {
  readonly lintFiles: readonly string[];
  readonly prettierFiles: readonly string[];
  readonly runTurbo: boolean;
  readonly allWorkspaces: boolean;
  readonly runRootScriptsTests: boolean;
  readonly runEslintConfigTest: boolean;
};

const eslintExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const prettierExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.yml',
  '.yaml',
]);

const extension = (file: string): string => file.slice(file.lastIndexOf('.'));

export const parseBaseRef = (argv: readonly string[]): string =>
  argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'origin/main';

export function partitionAffected(
  changedFiles: readonly string[],
  missingFiles: readonly string[] = [],
): AffectedPlan {
  const missing = new Set(missingFiles);
  const onDisk = (file: string) => !missing.has(file);
  const inWorkspace = (file: string) =>
    file.startsWith('apps/') || file.startsWith('packages/');
  // Unknown root inputs are global. Documentation alone cannot affect builds.
  const allWorkspaces = changedFiles.some(
    (file) =>
      (!inWorkspace(file) &&
        !file.startsWith('docs/') &&
        !file.endsWith('.md')) ||
      turboConfig.globalDependencies.some((pattern) =>
        new Bun.Glob(pattern).match(file),
      ),
  );
  return {
    allWorkspaces,
    lintFiles: changedFiles.filter(
      (file) => onDisk(file) && eslintExtensions.has(extension(file)),
    ),
    prettierFiles: changedFiles.filter(
      (file) => onDisk(file) && prettierExtensions.has(extension(file)),
    ),
    runTurbo: allWorkspaces || changedFiles.some(inWorkspace),
    runRootScriptsTests:
      allWorkspaces ||
      changedFiles.some(
        (file) =>
          file.startsWith('scripts/') || file === 'eslint.config.test.ts',
      ),
    runEslintConfigTest: changedFiles.some((file) =>
      file.startsWith('eslint.config'),
    ),
  };
}

export function affectedLintDirectories(value: unknown): readonly string[] {
  const tasks = (value as { tasks?: { directory?: unknown }[] })?.tasks;
  if (!Array.isArray(tasks)) throw new Error('Missing affected task graph');
  const directories = tasks.map(({ directory }) => {
    if (
      typeof directory !== 'string' ||
      !/^(apps|packages)\/[a-z0-9-]+$/.test(directory)
    )
      throw new Error('Invalid affected workspace directory');
    return directory;
  });
  return [...new Set(directories)].sort();
}

async function lintGraph(
  plan: AffectedPlan,
  mergeBase: string,
): Promise<AffectedPlan> {
  if (plan.allWorkspaces || !plan.runTurbo) return plan;
  const child = Bun.spawn(
    [
      'bunx',
      '--bun',
      'turbo',
      'run',
      'typecheck',
      '--filter',
      `...[${mergeBase}]`,
      '--dry=json',
    ],
    { cwd: root, stdout: 'pipe', stderr: 'inherit' },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error('Could not select affected lint graph');
  const directories = affectedLintDirectories(JSON.parse(output));
  // Deleted source still selects the producer and reverse dependents via Git.
  // Lint all their files: imported types can alter type-aware lint in consumers.
  return {
    ...plan,
    lintFiles: [
      ...directories,
      ...plan.lintFiles.filter(
        (file) => !directories.some((dir) => file.startsWith(`${dir}/`)),
      ),
    ],
  };
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(
      `git ${args.join(' ')} failed (exit ${exitCode}); fetch the base ref first (git fetch origin)`,
    );
  return stdout.trim();
}

const nonEmptyLines = (output: string): readonly string[] =>
  output.length === 0 ? [] : output.split('\n');

async function collectChangedFiles(
  mergeBase: string,
): Promise<readonly string[]> {
  const [committed, working, untracked] = await Promise.all([
    gitOutput(['diff', '--name-only', mergeBase]),
    gitOutput(['diff', '--name-only', 'HEAD']),
    gitOutput(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [
    ...new Set([
      ...nonEmptyLines(committed),
      ...nonEmptyLines(working),
      ...nonEmptyLines(untracked),
    ]),
  ].sort();
}

type Gate = { readonly name: string; readonly args: readonly string[] };

export function planGates(
  plan: AffectedPlan,
  mergeBase: string,
): readonly Gate[] {
  const gates: Gate[] = [];
  if (plan.allWorkspaces)
    gates.push({
      name: 'eslint (all files)',
      args: ['bunx', '--bun', 'eslint', '.'],
    });
  else if (plan.lintFiles.length > 0)
    gates.push({
      name: 'eslint (affected graph and root files)',
      // Turbo includes config-only workspaces; empty/ignored patterns are not
      // source failures. ESLint still reports all violations in matched source.
      args: [
        'bunx',
        '--bun',
        'eslint',
        '--no-error-on-unmatched-pattern',
        '--no-warn-ignored',
        ...plan.lintFiles,
      ],
    });
  if (plan.allWorkspaces)
    gates.push({
      name: 'prettier (all files)',
      args: ['bun', 'run', 'format:check'],
    });
  else if (plan.prettierFiles.length > 0)
    gates.push({
      name: 'prettier (changed files)',
      args: ['bunx', 'prettier', '--check', ...plan.prettierFiles],
    });
  gates.push({
    name: 'boundaries',
    args: ['bun', 'scripts/check-boundaries.ts'],
  });
  gates.push({ name: 'styling', args: ['bun', 'scripts/check-styling.ts'] });
  // knip and duplication are reports, not quick-check gates (ADR 0083).
  if (plan.runRootScriptsTests)
    gates.push({ name: 'root script tests', args: ['bun', 'test', 'scripts'] });
  if (plan.runEslintConfigTest)
    gates.push({
      name: 'eslint config tests',
      // As in the lint script: the 5 s default times out on a loaded machine.
      args: ['bun', 'test', '--timeout', '180000', 'eslint.config.test.ts'],
    });
  if (plan.runTurbo)
    gates.push({
      name: 'turbo affected (typecheck, test)',
      args: [
        'bunx',
        '--bun',
        'turbo',
        'run',
        'typecheck',
        'test',
        ...(plan.allWorkspaces ? [] : ['--filter', `...[${mergeBase}]`]),
      ],
    });
  return gates;
}

function formatAffectedReport(
  changedFiles: readonly string[],
  results: readonly { readonly name: string; readonly ok: boolean }[],
  json: boolean,
): string {
  if (json)
    return `${JSON.stringify({ ok: results.every(({ ok }) => ok), changedFiles, gates: results }, null, 2)}\n`;
  return [
    `Daisy check:affected — ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}`,
    ...results.map(({ name, ok }) => `${ok ? 'PASS' : 'FAIL'} ${name}`),
    'bun check is the full blocking gate; this inner loop skips policy, invariants and build.',
    '',
  ].join('\n');
}

async function runGate(gate: Gate): Promise<boolean> {
  const child = Bun.spawn(gate.args, {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await child.exited) === 0;
}

if (import.meta.main) {
  try {
    const mergeBase = await gitOutput([
      'merge-base',
      'HEAD',
      parseBaseRef(process.argv),
    ]);
    const changedFiles = await collectChangedFiles(mergeBase);
    const results: { name: string; ok: boolean }[] = [];
    const missingFiles = changedFiles.filter(
      (file) => !existsSync(resolve(root, file)),
    );
    const plan = await lintGraph(
      partitionAffected(changedFiles, missingFiles),
      mergeBase,
    );
    const full = process.argv.includes('--full');
    for (const gate of planGates(
      full
        ? {
            ...plan,
            allWorkspaces: true,
            runTurbo: true,
            runRootScriptsTests: true,
            runEslintConfigTest: true,
          }
        : plan,
      mergeBase,
    )) {
      const ok = await runGate(gate);
      results.push({ name: gate.name, ok });
      if (!ok) break;
    }
    process.stdout.write(
      formatAffectedReport(
        changedFiles,
        results,
        process.argv.includes('--json'),
      ),
    );
    process.exitCode = results.every(({ ok }) => ok) ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'check:affected failed'}\n`,
    );
    process.exitCode = 1;
  }
}
