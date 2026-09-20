import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const skipDirectories = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.pu',
  'dist',
  'test-results',
  'playwright-report',
]);

export type TestTier =
  'unit' | 'root-script' | 'root-config' | 'integration' | 'e2e' | 'orphan';

export type EvidenceProblemCode =
  'ORPHAN_SUITE' | 'UNRUN_SUITE' | 'GUARD_MISSING' | 'E2E_DUPLICATED';

export type EvidenceProblem = {
  readonly code: EvidenceProblemCode;
  readonly detail: string;
};

export type EvidenceReport = {
  readonly ok: boolean;
  readonly claimed: Readonly<Record<Exclude<TestTier, 'orphan'>, number>>;
  readonly problems: readonly EvidenceProblem[];
};

const testFilePattern = /(\.test\.ts|\.integration\.ts|\.e2e\.ts)$/;

export function isTestFilePath(relativePath: string): boolean {
  return testFilePattern.test(relativePath);
}

export function classifyTestFile(relativePath: string): TestTier {
  if (relativePath.startsWith('scripts/') && relativePath.endsWith('.test.ts'))
    return 'root-script';
  if (relativePath === 'eslint.config.test.ts') return 'root-config';
  if (relativePath.includes('/integration/')) return 'integration';
  if (
    relativePath.startsWith('apps/web/e2e/') &&
    relativePath.endsWith('.e2e.ts')
  )
    return 'e2e';
  if (/\/src\/.+\.(test|integration)\.ts$/.test(relativePath)) return 'unit';
  return 'orphan';
}

// A suite that nothing invokes is indistinguishable from a suite that does
// not exist (PageSpace lesson): every integration file must hard-fail on a
// missing test service instead of silently passing an empty run.
export function integrationGuardProblems(
  content: string,
  relativePath: string,
): readonly EvidenceProblem[] {
  const declaresTestEnvironment =
    content.includes('TEST_DATABASE_URL') || content.includes('TEST_REDIS_URL');
  const hardFails = content.includes('throw new Error');
  if (declaresTestEnvironment && hardFails) return [];
  return [
    {
      code: 'GUARD_MISSING',
      detail: `${relativePath} must declare TEST_DATABASE_URL or TEST_REDIS_URL and throw when absent (never skip)`,
    },
  ];
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function listTestFiles(
  directory: string,
  prefix = '',
): Promise<readonly string[]> {
  const entries = await readdir(join(root, directory, prefix), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name)) continue;
      files.push(...(await listTestFiles(directory, relativePath)));
    } else if (entry.isFile() && isTestFilePath(relativePath))
      files.push(relativePath);
  }
  return files;
}

async function workspaceDirectories(): Promise<readonly string[]> {
  const manifest = await readJson(join(root, 'package.json'));
  const patterns = (manifest.workspaces ?? []) as readonly string[];
  const directories: string[] = [];
  for (const pattern of patterns) {
    const base = pattern.replace(/\/\*$/, '');
    try {
      if (!(await stat(join(root, base))).isDirectory()) continue;
      for (const entry of await readdir(join(root, base), {
        withFileTypes: true,
      }))
        if (entry.isDirectory()) directories.push(`${base}/${entry.name}`);
    } catch {
      // A declared workspace root that does not exist is not a suite problem.
    }
  }
  return directories;
}

type ScriptMap = Readonly<Record<string, string>>;

const readScripts = async (path: string): Promise<ScriptMap> => {
  const manifest = await readJson(path);
  return (manifest.scripts ?? {}) as ScriptMap;
};

const rootClaimProblems = (scripts: ScriptMap): readonly EvidenceProblem[] => {
  const problems: EvidenceProblem[] = [];
  const claims: readonly [string, string][] = [
    ['test', 'bun test scripts'],
    ['lint', 'eslint.config.test.ts'],
    ['check', 'invariants'],
    ['check', 'evidence'],
  ];
  for (const [script, needle] of claims)
    if (!(scripts[script] ?? '').includes(needle))
      problems.push({
        code: 'UNRUN_SUITE',
        detail: `root "${script}" script does not invoke ${needle}; the corresponding suites would not run in bun check`,
      });
  return problems;
};

const workspaceClaimProblems = async (
  byWorkspace: ReadonlyMap<string, { unit: string[]; integration: string[] }>,
): Promise<readonly EvidenceProblem[]> => {
  const problems: EvidenceProblem[] = [];
  for (const [workspace, bucket] of byWorkspace) {
    const scripts = await readScripts(join(root, workspace, 'package.json'));
    if (bucket.unit.length > 0 && scripts.test !== 'bun test src')
      problems.push({
        code: 'UNRUN_SUITE',
        detail: `${workspace} has src suites but its "test" script is not "bun test src"`,
      });
    for (const file of bucket.integration) {
      if (
        !(scripts['test:integration'] ?? '').includes(
          file.split('/').pop() ?? file,
        )
      )
        problems.push({
          code: 'UNRUN_SUITE',
          detail: `${workspace} "test:integration" does not invoke ${file}`,
        });
      const content = await readFile(join(root, file), 'utf8');
      problems.push(...integrationGuardProblems(content, file));
    }
  }
  return problems;
};

const e2eClaimProblems = async (
  e2eCount: number,
): Promise<readonly EvidenceProblem[]> => {
  if (e2eCount === 0) return [];
  const problems: EvidenceProblem[] = [];
  const webScripts = await readScripts(join(root, 'apps/web/package.json'));
  if (!webScripts['test:e2e']?.includes('@playwright/test/cli.js'))
    problems.push({
      code: 'UNRUN_SUITE',
      detail:
        'apps/web e2e suites exist but "test:e2e" no longer drives Playwright',
    });
  const e2eWorkflow = await readTextIfExists(
    join(root, '.github/workflows/e2e.yml'),
  );
  if (!e2eWorkflow?.includes('test:e2e'))
    problems.push({
      code: 'UNRUN_SUITE',
      detail:
        'no workflow invokes test:e2e; the browser tier would silently stop running in CI',
    });
  return problems;
};

const ciWiringProblems = async (): Promise<readonly EvidenceProblem[]> => {
  const problems: EvidenceProblem[] = [];
  const ciWorkflow = await readTextIfExists(
    join(root, '.github/workflows/ci.yml'),
  );
  if (ciWorkflow?.includes('test:e2e'))
    problems.push({
      code: 'E2E_DUPLICATED',
      detail: 'ci.yml runs the browser suite; e2e.yml is the single E2E owner',
    });
  for (const gate of ['knip', 'invariants', 'evidence', 'migrations:check'])
    if (!ciWorkflow?.includes(gate))
      problems.push({
        code: 'UNRUN_SUITE',
        detail: `ci.yml does not run ${gate}; the gate would silently stop running in CI`,
      });
  return problems;
};

export async function collectEvidence(): Promise<EvidenceReport> {
  const testFiles = [...(await listTestFiles('.'))].sort();
  const classified = testFiles.map((file) => ({
    file,
    tier: classifyTestFile(file),
  }));
  const tiers = {
    unit: 0,
    'root-script': 0,
    'root-config': 0,
    integration: 0,
    e2e: 0,
  };
  const orphanProblems: EvidenceProblem[] = [];
  for (const { file, tier } of classified) {
    if (tier === 'orphan')
      orphanProblems.push({
        code: 'ORPHAN_SUITE',
        detail: `${file} is not claimed by any runner; move it under a claimed location (src/, scripts/, integration/, apps/web/e2e/)`,
      });
    else tiers[tier] += 1;
  }

  const workspaces = await workspaceDirectories();
  const byWorkspace = new Map<
    string,
    { unit: string[]; integration: string[] }
  >(workspaces.map((name) => [name, { unit: [], integration: [] }]));
  for (const { file, tier } of classified) {
    if (tier === 'orphan') continue;
    const workspace = workspaces.find((name) => file.startsWith(`${name}/`));
    const bucket = byWorkspace.get(workspace ?? '');
    if (!bucket) continue;
    if (tier === 'unit') bucket.unit.push(file);
    if (tier === 'integration') bucket.integration.push(file);
  }

  const problems: EvidenceProblem[] = [
    ...orphanProblems,
    ...rootClaimProblems(await readScripts(join(root, 'package.json'))),
    ...(await workspaceClaimProblems(byWorkspace)),
    ...(await e2eClaimProblems(tiers.e2e)),
    ...(await ciWiringProblems()),
  ];
  return {
    ok: problems.length === 0,
    claimed: tiers,
    problems,
  };
}

export function formatEvidenceReport(
  report: EvidenceReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  const counts = Object.entries(report.claimed)
    .map(([tier, count]) => `${tier}:${count}`)
    .join(' ');
  return [
    `Daisy evidence: ${report.ok ? 'PASS' : 'FAIL'} (${counts})`,
    ...report.problems.map(({ code, detail }) => `  ${code}: ${detail}`),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const report = await collectEvidence();
  process.stdout.write(
    formatEvidenceReport(report, process.argv.includes('--json')),
  );
  process.exitCode = report.ok ? 0 : 1;
}
