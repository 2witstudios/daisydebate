/**
 * Declarative boundary rules for the architecture scan. Side-effect-free by
 * contract: unit tests import this module directly, so it must not touch the
 * filesystem or process state. The scan itself lives in check-boundaries.ts.
 */

// ADR 0006: Adobe vendor packages live in the engine adapter only. The web
// UI shell attempted an exception (ADR 0024 attempt) but client-side ECS
// codegen conflicts with the strict CSP; the boundary stays engine-only.
export const adobeWorkspaces = ['@daisy/debate-engine'] as const;

export const adobeIsolationIssue = (
  workspaceName: string,
  specifier: string,
  kind: 'dependency' | 'import',
): string | null => {
  if (!specifier.startsWith('@adobe/')) return null;
  if ((adobeWorkspaces as readonly string[]).includes(workspaceName)) {
    return null;
  }
  return `${workspaceName}: Adobe ${kind} outside the engine`;
};

/** Workspace suffixes (after `@daisy/`) each workspace may depend on. */
export const allowedWorkspaceDependencies: Record<string, readonly string[]> = {
  'debate-engine': ['errors', 'protocol'],
  protocol: ['errors'],
  auth: ['errors'],
  errors: [],
  db: ['config', 'errors', 'protocol'],
  redis: ['config', 'errors', 'protocol'],
  config: [],
  logger: [],
  observability: ['logger'],
  // ADR 0031 §12: the realtime deployment's exact ten allowed edges. It
  // never depends on `debate-engine`, `apps/web` or a third-party socket
  // library. `@daisy/presence` is not yet a package (owned by a later RT
  // leaf); the edge is declared now so nothing else moves when it lands.
  realtime: [
    'protocol',
    'auth',
    'db',
    'redis',
    'clock',
    'config',
    'errors',
    'logger',
    'observability',
    'presence',
  ],
};

/**
 * Mirrors `adobeIsolationIssue`'s shape: a pure predicate the scan and its
 * unit tests both call, so "a workspace's edges are mechanically enforced"
 * (ADR 0031 §12) is provable without re-deriving the rule in a test fixture.
 * A workspace absent from `allowedWorkspaceDependencies` is unrestricted.
 */
export const forbiddenDependencyIssue = (
  workspacePath: string,
  workspaceName: string,
  dependency: string,
  allowed: Readonly<Record<string, readonly string[]>>,
): string | null => {
  const restrictions = allowed[workspaceName.replace('@daisy/', '')];
  if (
    dependency.startsWith('@daisy/') &&
    restrictions &&
    !restrictions.includes(dependency.replace('@daisy/', ''))
  )
    return `${workspacePath}: forbidden dependency ${dependency}`;
  return null;
};

/**
 * A workspace import must name the package root or a subpath its `exports`
 * map declares (public API, e.g. `@daisy/errors/testing`); anything else
 * reaches into another package's files. Third-party subpaths are left to
 * the dependency rules.
 */
export const deepImportIssue = (
  specifier: string,
  exportsOf: (packageName: string) => unknown,
): string | null => {
  if (!specifier.startsWith('@daisy/')) return null;
  const packageName = specifier.split('/').slice(0, 2).join('/');
  if (specifier === packageName) return null;
  const exported = exportsOf(packageName);
  const subpath = `.${specifier.slice(packageName.length)}`;
  return exported !== null &&
    typeof exported === 'object' &&
    Object.hasOwn(exported, subpath)
    ? null
    : `workspace deep import ${specifier}`;
};
