import { z } from 'zod';

/** The completed Browser E2E runs for pushes to main, newest first. */
export const mainBrowserRunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      conclusion: z.string().nullable(),
      head_sha: z.string(),
      html_url: z.string(),
    }),
  ),
});

type MainBrowserRun = z.infer<
  typeof mainBrowserRunsSchema
>['workflow_runs'][number];

/** The query for main's latest completed Browser E2E push run. */
export const mainBrowserRunsPath = (repository: string) =>
  `repos/${repository}/actions/workflows/e2e.yml/runs?branch=main&event=push&status=completed&per_page=1`;

const red = new Set(['failure', 'timed_out']);

/**
 * ADR 0159 §3: nothing merges while main's latest Browser E2E push run is
 * red, except the PR that fixes it, which names that exact run.
 */
export function mainBrowserGate(
  latest: MainBrowserRun | undefined,
  fixesRun: number | undefined,
):
  | { readonly merge: true }
  | { readonly merge: false; readonly reason: string } {
  if (!latest)
    return {
      merge: false,
      reason: 'No completed Browser E2E run for a push to main was found',
    };
  const isRed = red.has(latest.conclusion ?? '');
  if (!isRed && fixesRun === undefined) return { merge: true };
  if (!isRed)
    return {
      merge: false,
      reason: `Main's latest Browser E2E run ${String(latest.id)} is ${latest.conclusion ?? 'unknown'}; drop --fixes-main-run`,
    };
  if (fixesRun === latest.id) return { merge: true };
  return {
    merge: false,
    reason: `Main's latest Browser E2E run is red (${latest.html_url}). Merge only the PR that fixes or reverts it, with --fixes-main-run ${String(latest.id)}`,
  };
}
