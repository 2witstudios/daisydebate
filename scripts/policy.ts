import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const registryPath = join(root, 'policy/exceptions.json');
const skipped = new Set([
  '.git',
  '.next',
  '.pu',
  '.turbo',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const scannedExtensions = new Set([
  '.js',
  '.jsx',
  '.json',
  '.sql',
  '.ts',
  '.tsx',
]);
const categories = new Set<PolicyCategory>([
  'framework',
  'integration-isolation',
  'migration',
  'tooling',
]);

export type PolicyRule = 'direct-random-uuid' | 'repository-owned-uuid';
export type PolicyCategory =
  'framework' | 'integration-isolation' | 'migration' | 'tooling';
export type PolicyException = {
  readonly path: string;
  readonly rule: PolicyRule;
  readonly category: PolicyCategory;
  readonly owner: string;
  readonly reason: string;
};
export type PolicyFinding = {
  readonly path: string;
  readonly line: number;
  readonly rule: PolicyRule;
  readonly detail: string;
};
export type PolicyReport = {
  readonly ok: boolean;
  readonly findings: readonly PolicyFinding[];
  readonly registryProblems: readonly string[];
};

const rules: Readonly<Record<PolicyRule, RegExp>> = {
  'direct-random-uuid': /\b(?:crypto\.)?randomUUID\s*\(/,
  'repository-owned-uuid':
    /\b(?:z\.uuid\s*\(|uuid\s*\(|uuidv[134]\s*\(|from\s+['"]uuid['"]|::uuid\b)/i,
};

export function scanPolicyText(
  path: string,
  content: string,
): readonly PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const [lineIndex, line] of content.split('\n').entries()) {
    for (const [rule, pattern] of Object.entries(rules) as [
      PolicyRule,
      RegExp,
    ][]) {
      if (pattern.test(line))
        findings.push({
          path,
          line: lineIndex + 1,
          rule,
          detail: line.trim(),
        });
    }
  }
  return findings;
}

export function validatePolicyRegistry(registry: {
  version?: unknown;
  exceptions?: unknown;
}): readonly string[] {
  const problems: string[] = [];
  if (registry.version !== 1) problems.push('registry: version must be 1');
  if (!Array.isArray(registry.exceptions)) {
    return [...problems, 'registry: exceptions must be an array'];
  }
  const seen = new Set<string>();
  for (const [index, value] of registry.exceptions.entries()) {
    const entry = value as Partial<PolicyException>;
    const prefix = `registry[${index}]`;
    for (const field of [
      'path',
      'rule',
      'category',
      'owner',
      'reason',
    ] as const)
      if (typeof entry[field] !== 'string' || entry[field].trim() === '')
        problems.push(`${prefix}: ${field} is required`);
    if (typeof entry.path === 'string' && entry.path.includes('*'))
      problems.push(`${prefix}: wildcard paths are not allowed`);
    if (typeof entry.rule === 'string' && !(entry.rule in rules))
      problems.push(`${prefix}: unknown rule ${entry.rule}`);
    if (
      typeof entry.category === 'string' &&
      !categories.has(entry.category as PolicyCategory)
    )
      problems.push(`${prefix}: unknown category ${entry.category}`);
    const key = `${entry.path}|${entry.rule}`;
    if (seen.has(key)) problems.push(`${prefix}: duplicate ${key}`);
    seen.add(key);
  }
  return problems;
}

async function filesIn(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name))
        files.push(...(await filesIn(join(directory, entry.name))));
    } else if (
      entry.isFile() &&
      scannedExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))
    ) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

export async function collectPolicy(): Promise<PolicyReport> {
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as {
    version?: unknown;
    exceptions?: readonly PolicyException[];
  };
  const problems = validatePolicyRegistry(registry);
  const exceptions = new Set(
    (registry.exceptions ?? []).map(({ path, rule }) => `${path}|${rule}`),
  );
  const findings: PolicyFinding[] = [];
  for (const file of await filesIn(root)) {
    const path = relative(root, file);
    if (path === 'scripts/policy.ts' || path === 'scripts/policy.test.ts')
      continue;
    for (const finding of scanPolicyText(path, await readFile(file, 'utf8')))
      if (!exceptions.has(`${finding.path}|${finding.rule}`))
        findings.push(finding);
  }
  return {
    ok: problems.length === 0 && findings.length === 0,
    findings,
    registryProblems: problems,
  };
}

export function formatPolicyReport(
  report: PolicyReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  return [
    `Daisy policy: ${report.ok ? 'PASS' : 'FAIL'}`,
    ...report.registryProblems.map((problem) => `  REGISTRY: ${problem}`),
    ...report.findings.map(
      ({ path, line, rule, detail }) =>
        `  ${rule}: ${path}:${line} (${detail})`,
    ),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const report = await collectPolicy();
  process.stdout.write(
    formatPolicyReport(report, process.argv.includes('--json')),
  );
  process.exitCode = report.ok ? 0 : 1;
}
