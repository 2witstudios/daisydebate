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
  redis: ['config', 'errors'],
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
