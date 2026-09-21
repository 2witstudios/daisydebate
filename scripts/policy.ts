import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

import { reviewDateStatus, utcToday } from './review-date';

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
  readonly adr: string;
  readonly reviewBy: string;
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

function aliasedRandomUuidFindings(
  path: string,
  content: string,
): readonly PolicyFinding[] {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : path.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS,
  );
  const aliases = new Set<string>();
  const findings: PolicyFinding[] = [];

  function collectAliases(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      (node.moduleSpecifier.text === 'node:crypto' ||
        node.moduleSpecifier.text === 'crypto') &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        if (
          element.propertyName?.text === 'randomUUID' &&
          ts.isIdentifier(element.name)
        )
          aliases.add(element.name.text);
      }
    }
    ts.forEachChild(node, collectAliases);
  }

  const findingLines = new Set<number>();
  function collectCalls(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliases.has(node.expression.text) &&
      !findingLines.has(
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      )
    ) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      findingLines.add(line);
      findings.push({
        path,
        line,
        rule: 'direct-random-uuid',
        detail: content.split('\n')[line - 1]?.trim() ?? '',
      });
    }

    ts.forEachChild(node, collectCalls);
  }

  collectAliases(sourceFile);
  collectCalls(sourceFile);
  return findings;
}

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
  const existingLines = new Set(
    findings
      .filter(({ rule }) => rule === 'direct-random-uuid')
      .map(({ line }) => line),
  );
  return [
    ...findings,
    ...aliasedRandomUuidFindings(path, content).filter(
      ({ line }) => !existingLines.has(line),
    ),
  ];
}

export type PolicyRegistryValidationOptions = {
  readonly knownPaths?: ReadonlySet<string>;
  readonly today?: string;
};

type RegistryEntry = Partial<PolicyException>;

function requiredFieldProblems(
  entry: RegistryEntry,
  prefix: string,
): readonly string[] {
  return (
    ['path', 'rule', 'category', 'owner', 'reason', 'adr', 'reviewBy'] as const
  )
    .filter(
      (field) => typeof entry[field] !== 'string' || entry[field].trim() === '',
    )
    .map((field) => `${prefix}: ${field} is required`);
}

function referenceProblems(
  entry: RegistryEntry,
  prefix: string,
  knownPaths: ReadonlySet<string> | undefined,
): readonly string[] {
  const problems: string[] = [];
  if (typeof entry.path === 'string' && entry.path.includes('*'))
    problems.push(`${prefix}: wildcard paths are not allowed`);
  if (
    typeof entry.path === 'string' &&
    knownPaths &&
    !knownPaths.has(entry.path)
  )
    problems.push(`${prefix}: path does not exist: ${entry.path}`);
  if (typeof entry.rule === 'string' && !(entry.rule in rules))
    problems.push(`${prefix}: unknown rule ${entry.rule}`);
  if (
    typeof entry.category === 'string' &&
    !categories.has(entry.category as PolicyCategory)
  )
    problems.push(`${prefix}: unknown category ${entry.category}`);
  if (
    typeof entry.adr === 'string' &&
    !/^docs\/decisions\/\d{4}-[a-z0-9-]+\.md$/.test(entry.adr)
  )
    problems.push(`${prefix}: invalid ADR reference ${entry.adr}`);
  if (typeof entry.adr === 'string' && knownPaths && !knownPaths.has(entry.adr))
    problems.push(`${prefix}: ADR does not exist: ${entry.adr}`);
  return problems;
}

function reviewDateProblems(
  reviewBy: string | undefined,
  prefix: string,
  today: string,
): readonly string[] {
  if (typeof reviewBy !== 'string') return [];
  const status = reviewDateStatus(reviewBy, today);
  if (status === 'invalid') return [`${prefix}: reviewBy must be an ISO date`];
  return status === 'expired'
    ? [`${prefix}: reviewBy has expired: ${reviewBy}`]
    : [];
}

function exceptionProblems(
  entry: RegistryEntry,
  prefix: string,
  options: PolicyRegistryValidationOptions,
  today: string,
): readonly string[] {
  return [
    ...requiredFieldProblems(entry, prefix),
    ...referenceProblems(entry, prefix, options.knownPaths),
    ...reviewDateProblems(entry.reviewBy, prefix, today),
  ];
}

export function validatePolicyRegistry(
  registry: { version?: unknown; exceptions?: unknown },
  options: PolicyRegistryValidationOptions = {},
): readonly string[] {
  const problems: string[] = [];
  const today = options.today ?? utcToday();
  if (registry.version !== 1) problems.push('registry: version must be 1');
  if (!Array.isArray(registry.exceptions)) {
    return [...problems, 'registry: exceptions must be an array'];
  }
  const seen = new Set<string>();
  for (const [index, value] of registry.exceptions.entries()) {
    const entry = value as RegistryEntry;
    const prefix = `registry[${index}]`;
    problems.push(...exceptionProblems(entry, prefix, options, today));
    const key = `${entry.path}|${entry.rule}`;
    if (seen.has(key)) problems.push(`${prefix}: duplicate ${key}`);
    seen.add(key);
  }
  return problems;
}

export type MigrationBaseline = {
  readonly baseJournalHash: string;
  readonly adr: string;
  readonly owner: string;
  readonly reason: string;
  readonly reviewBy: string;
};

export function validateMigrationBaselines(
  registry: { version?: unknown; baselines?: unknown },
  options: PolicyRegistryValidationOptions = {},
): readonly string[] {
  const problems: string[] = [];
  const today = options.today ?? utcToday();
  if (registry.version !== 1) problems.push('registry: version must be 1');
  if (!Array.isArray(registry.baselines)) {
    return [...problems, 'registry: baselines must be an array'];
  }
  for (const [index, value] of registry.baselines.entries()) {
    const entry = value as Partial<MigrationBaseline>;
    const prefix = `baselines[${index}]`;
    for (const field of [
      'baseJournalHash',
      'adr',
      'owner',
      'reason',
      'reviewBy',
    ] as const)
      if (typeof entry[field] !== 'string' || entry[field].trim() === '')
        problems.push(`${prefix}: ${field} is required`);
    if (
      typeof entry.baseJournalHash === 'string' &&
      !/^sha256:[0-9a-f]{64}$/.test(entry.baseJournalHash)
    )
      problems.push(
        `${prefix}: baseJournalHash must be sha256:<64 lowercase hex>`,
      );
    problems.push(
      ...referenceProblems(
        { adr: entry.adr } as RegistryEntry,
        prefix,
        options.knownPaths,
      ),
    );
    if (typeof entry.reviewBy === 'string')
      problems.push(...reviewDateProblems(entry.reviewBy, prefix, today));
  }
  return problems;
}

// Citations read "ADR 0017", so two records sharing a number make every such
// citation ambiguous. Nested directories and unnumbered files are ignored.
export function duplicateAdrNumberProblems(
  paths: Iterable<string>,
): readonly string[] {
  const byNumber = new Map<string, string[]>();
  for (const path of paths) {
    const number = /^docs\/decisions\/(\d{4})-[^/]+\.md$/.exec(path)?.[1];
    if (number !== undefined)
      byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  return [...byNumber]
    .filter(([, files]) => files.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([number, files]) =>
        `decisions: ADR number ${number} is shared by ${[...files].sort().join(', ')}`,
    );
}

async function filesIn(
  directory: string,
  extensions: ReadonlySet<string> | undefined,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name))
        files.push(...(await filesIn(join(directory, entry.name), extensions)));
    } else if (
      entry.isFile() &&
      (extensions === undefined ||
        extensions.has(entry.name.slice(entry.name.lastIndexOf('.'))))
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
  const baselinesRegistry = (await Bun.file(
    resolve(root, 'policy/migration-baselines.json'),
  ).exists())
    ? ((await Bun.file(
        resolve(root, 'policy/migration-baselines.json'),
      ).json()) as {
        version?: unknown;
        baselines?: readonly MigrationBaseline[];
      })
    : { version: 1, baselines: [] };
  const repositoryFiles = await filesIn(root, scannedExtensions);
  const knownPaths = new Set(
    (await filesIn(root, undefined)).map((file) => relative(root, file)),
  );
  const problems = [
    ...validatePolicyRegistry(registry, { knownPaths }),
    ...validateMigrationBaselines(baselinesRegistry, { knownPaths }),
    ...duplicateAdrNumberProblems(knownPaths),
  ];
  const exceptions = new Set(
    (registry.exceptions ?? []).map(({ path, rule }) => `${path}|${rule}`),
  );
  const findings: PolicyFinding[] = [];
  for (const file of repositoryFiles) {
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
