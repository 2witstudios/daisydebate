import type { EvidenceProblem } from './evidence';

/**
 * ADR 0077: the admin journey runs from apps/admin's own Playwright config,
 * which e2e.yml must invoke, or the suite would silently stop running.
 */
export const adminE2EClaimProblems = (
  suites: number,
  scripts: Readonly<Record<string, string>>,
  workflow: string,
): readonly EvidenceProblem[] =>
  suites === 0
    ? []
    : [
        ...(scripts['test:e2e']?.includes('@playwright/test/cli.js')
          ? []
          : [
              'apps/admin e2e suites exist but its "test:e2e" no longer drives Playwright',
            ]),
        ...(workflow.includes('--cwd apps/admin test:e2e')
          ? []
          : [
              'no workflow invokes apps/admin test:e2e; the admin browser journey would silently stop running in CI',
            ]),
      ].map((detail) => ({ code: 'UNRUN_SUITE' as const, detail }));
