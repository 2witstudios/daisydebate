#!/usr/bin/env bun
/**
 * The dependency audit (`bun run audit`, CI's audit job). Runs `bun audit`
 * with one `--ignore` per advisory in policy/audit-exceptions.json and
 * nothing broader: no `--audit-level`, no blanket ignore, so any advisory
 * the registry does not name still fails (ADR 0039). `bun policy` validates
 * the registry against the live advisories, so an exception that expires or
 * outlives its advisory fails the gate instead of rotting.
 */
import { join, resolve } from 'node:path';

import { reviewDateStatus, utcToday } from './review-date';

export type AuditException = {
  readonly advisory: string;
  /** Every package bun audit reports under this advisory, sorted. */
  readonly packages: readonly string[];
  readonly dependencyPath: string;
  readonly reason: string;
  /** Why Daisy cannot reach the vulnerable code. */
  readonly unreachable: string;
  readonly owner: string;
  readonly adr: string;
  readonly reviewBy: string;
};

type Registry = { readonly version?: unknown; readonly advisories?: unknown };
/** GHSA id → the sorted package names bun audit reports it on. */
type LiveAdvisories = ReadonlyMap<string, readonly string[]>;

const root = resolve(import.meta.dir, '..');
const auditRegistryPath = join(root, 'policy/audit-exceptions.json');
const ghsa = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const textFields = [
  'dependencyPath',
  'reason',
  'unreachable',
  'owner',
  'adr',
  'reviewBy',
] as const;

const entriesOf = (registry: Registry): readonly Partial<AuditException>[] =>
  Array.isArray(registry.advisories) ? registry.advisories : [];

export const auditCommand = (registry: Registry): readonly string[] => [
  'bun',
  'audit',
  ...entriesOf(registry).map(({ advisory }) => `--ignore=${advisory}`),
];

export function liveAdvisories(auditJson: unknown): LiveAdvisories {
  const byAdvisory = new Map<string, string[]>();
  for (const [name, advisories] of Object.entries(
    auditJson as Record<string, readonly { readonly url?: string }[]>,
  ))
    for (const { url } of advisories) {
      const id = url?.split('/').at(-1) ?? '';
      byAdvisory.set(id, [...(byAdvisory.get(id) ?? []), name].sort());
    }
  return new Map([...byAdvisory].sort(([a], [b]) => a.localeCompare(b)));
}

const packagesOf = (entry: Partial<AuditException>): readonly unknown[] =>
  Array.isArray(entry.packages) ? entry.packages : [];

function shapeProblems(entry: Partial<AuditException>): readonly string[] {
  const problems = textFields
    .filter(
      (field) => typeof entry[field] !== 'string' || entry[field].trim() === '',
    )
    .map((field) => `${field} is required`);
  if (typeof entry.advisory !== 'string' || !ghsa.test(entry.advisory))
    problems.push(`advisory must be a GHSA id, got ${String(entry.advisory)}`);
  const packages = packagesOf(entry);
  if (
    packages.length === 0 ||
    packages.some((name) => typeof name !== 'string' || name === '')
  )
    problems.push('packages must list at least one package name');
  return problems;
}

function referenceProblems(
  { adr, reviewBy }: Partial<AuditException>,
  options: AuditValidationOptions,
): readonly string[] {
  const problems: string[] = [];
  if (typeof adr === 'string' && options.knownPaths?.has(adr) === false)
    problems.push(`ADR does not exist: ${adr}`);
  const status =
    typeof reviewBy === 'string'
      ? reviewDateStatus(reviewBy, options.today ?? utcToday())
      : 'live';
  if (status === 'invalid') problems.push('reviewBy must be an ISO date');
  if (status === 'expired') problems.push(`reviewBy has expired: ${reviewBy}`);
  return problems;
}

/** An exception must name exactly the packages its live advisory reaches. */
function liveProblems(
  entry: Partial<AuditException>,
  live: LiveAdvisories | undefined,
): readonly string[] {
  if (!live || typeof entry.advisory !== 'string') return [];
  const affected = live.get(entry.advisory)?.join(', ');
  const listed = [...packagesOf(entry)].map(String).sort().join(', ');
  if (affected === undefined)
    return [
      `${entry.advisory} no longer matches a live advisory; remove the exception`,
    ];
  return affected === listed
    ? []
    : [
        `${entry.advisory} affects ${affected}, but the exception lists ${listed}`,
      ];
}

export type AuditValidationOptions = {
  readonly today?: string;
  readonly knownPaths?: ReadonlySet<string>;
  /** Omit to check the registry's shape and dates without the network. */
  readonly live?: LiveAdvisories;
};

export function validateAuditExceptions(
  registry: Registry,
  options: AuditValidationOptions = {},
): readonly string[] {
  const problems: string[] = [];
  if (registry.version !== 1) problems.push('audit: version must be 1');
  if (!Array.isArray(registry.advisories))
    return [...problems, 'audit: advisories must be an array'];
  const seen = new Set<unknown>();
  for (const [index, entry] of entriesOf(registry).entries()) {
    const prefix = `audit[${index}]`;
    problems.push(
      ...[
        ...shapeProblems(entry),
        ...referenceProblems(entry, options),
        ...liveProblems(entry, options.live),
      ].map((problem) => `${prefix}: ${problem}`),
    );
    if (seen.has(entry.advisory))
      problems.push(`${prefix}: duplicate advisory ${entry.advisory}`);
    seen.add(entry.advisory);
  }
  return problems;
}

/** What `bun audit --json` printed and how it exited. */
type AuditOutput = {
  readonly stdout: string;
  readonly exitCode: number | null;
};

/**
 * Validates the registry against the advisories bun audit printed. Output
 * that is not an advisory map fails rather than passing, and the offline
 * checks still run.
 */
export function liveAuditProblems(
  registry: Registry,
  audit: AuditOutput,
  options: Omit<AuditValidationOptions, 'live'>,
): readonly string[] {
  try {
    const live = liveAdvisories(JSON.parse(audit.stdout));
    return validateAuditExceptions(registry, { ...options, live });
  } catch {
    return [
      ...validateAuditExceptions(registry, options),
      `audit: could not read live advisories (bun audit --json exited ${audit.exitCode})`,
    ];
  }
}

/** One root override as "<parent> > <package>@<version>" or "<package>@<version>". */
export function flattenOverrides(overrides: unknown): readonly string[] {
  if (typeof overrides !== 'object' || overrides === null) return [];
  return Object.entries(overrides).flatMap(([name, value]) =>
    typeof value === 'string'
      ? [`${name}@${value}`]
      : typeof value === 'object' && value !== null
        ? Object.entries(value).map(
            ([child, version]) => `${name} > ${child}@${String(version)}`,
          )
        : [`${name}@${String(value)}`],
  );
}

const overridesHeading = '### Security overrides';

/**
 * The overrides docs/dependencies.md records: the first cell of each row of
 * its Security overrides table, as `pkg` → `version` or
 * `parent` → `pkg` `version` (ADR 0152).
 */
export function documentedOverrides(markdown: string): readonly string[] {
  const start = markdown.indexOf(overridesHeading);
  if (start === -1) return [];
  const rows = markdown
    .slice(start + overridesHeading.length)
    .split('\n')
    .map((line) => line.trim());
  const table = rows
    .slice(rows.findIndex((line) => line.startsWith('|')))
    .filter((line, index, lines) =>
      lines.slice(0, index + 1).every((row) => row.startsWith('|')),
    )
    .slice(2);
  return table.flatMap((row) => {
    const names = [...(row.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map(
      ([, name]) => name,
    );
    if (names.length === 2) return [`${names[0]}@${names[1]}`];
    if (names.length === 3) return [`${names[0]} > ${names[1]}@${names[2]}`];
    return [`unparsed row: ${row.split('|')[1]?.trim() ?? row}`];
  });
}

/**
 * Every root override is documented, and every documented override is
 * still in package.json, with the same version, so a pin cannot outlive
 * its record or appear without one (ADR 0152).
 */
export function overrideProblems(
  overrides: unknown,
  markdown: string,
): readonly string[] {
  const actual = new Set(flattenOverrides(overrides));
  const documented = new Set(documentedOverrides(markdown));
  return [
    ...[...actual]
      .filter((override) => !documented.has(override))
      .map(
        (override) =>
          `overrides: ${override} is not in docs/dependencies.md § Security overrides`,
      ),
    ...[...documented]
      .filter((override) => !actual.has(override))
      .map(
        (override) =>
          `overrides: docs/dependencies.md lists ${override}, which package.json overrides does not pin`,
      ),
  ];
}

/** A file whose change can alter what the advisory database says of this branch. */
const dependencyInput = (path: string) =>
  path === 'bun.lock' ||
  path === 'policy/audit-exceptions.json' ||
  path === 'scripts/audit.ts' ||
  /(^|\/)package\.json$/.test(path);

export type AuditScope = { readonly live: boolean; readonly reason: string };

/**
 * Whether this run asks the live advisory database. An advisory published
 * overnight is no fault of a branch that touched no dependency, and it used
 * to fail every open PR at once. So a branch is audited when it changes a
 * dependency input, the nightly run audits main, and a branch that cannot be
 * compared with main is audited too.
 */
export function auditScope({
  forced,
  changed,
}: {
  readonly forced: boolean;
  /** Paths changed since main, or undefined when they cannot be worked out. */
  readonly changed: readonly string[] | undefined;
}): AuditScope {
  if (forced) return { live: true, reason: 'the scheduled run audits main' };
  if (changed === undefined)
    return { live: true, reason: 'this checkout cannot be compared with main' };
  const input = changed.find(dependencyInput);
  return input
    ? { live: true, reason: `${input} changed since main` }
    : {
        live: false,
        reason:
          'no dependency input changed since main; the nightly run audits main',
      };
}

const changedSinceMain = (): readonly string[] | undefined => {
  const git = (args: readonly string[]) =>
    Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'ignore' });
  const base = git(['merge-base', 'HEAD', 'origin/main']);
  if (base.exitCode !== 0) return undefined;
  // Against the base itself, so uncommitted edits count too.
  const diff = git(['diff', '--name-only', base.stdout.toString().trim()]);
  return diff.exitCode === 0
    ? diff.stdout.toString().split('\n').filter(Boolean)
    : undefined;
};

export const currentAuditScope = (
  env: Record<string, string | undefined> = process.env,
): AuditScope =>
  auditScope({
    forced:
      env.DAISY_LIVE_AUDIT === '1' || env.GITHUB_EVENT_NAME === 'schedule',
    changed: changedSinceMain(),
  });

/** `bun policy`'s edge: runs the unfiltered audit on the root lockfile. */
export async function auditPolicyProblems(
  knownPaths: ReadonlySet<string>,
  scope: AuditScope = currentAuditScope(),
): Promise<readonly string[]> {
  const manifest = (await Bun.file(join(root, 'package.json')).json()) as {
    readonly overrides?: unknown;
  };
  const live = () => {
    const result = Bun.spawnSync(['bun', 'audit', '--json'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { stdout: result.stdout.toString(), exitCode: result.exitCode };
  };
  return [
    ...(scope.live
      ? liveAuditProblems(
          (await Bun.file(auditRegistryPath).json()) as Registry,
          live(),
          { knownPaths },
        )
      : []),
    ...overrideProblems(
      manifest.overrides,
      await Bun.file(join(root, 'docs/dependencies.md')).text(),
    ),
  ];
}

if (import.meta.main) {
  const registry = (await Bun.file(auditRegistryPath).json()) as Registry;
  const problems = validateAuditExceptions(registry);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exit(1);
  }
  const scope = currentAuditScope();
  process.stdout.write(
    `audit: ${scope.live ? 'asking' : 'not asking'} the advisory database (${scope.reason})\n`,
  );
  if (!scope.live) process.exit(0);
  const audit = Bun.spawnSync([...auditCommand(registry)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(audit.exitCode ?? 1);
}
