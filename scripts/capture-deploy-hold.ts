#!/usr/bin/env bun
/**
 * Holds the capture worker's deploy while capture is live (ADR 0094, CCAP-10),
 * since replacing the only worker during speech leaves a gap. The hold is a
 * courtesy, never a gate: it always ends, and it always lets the deploy go.
 */
const POLL_MS = 30_000;
/** Long enough for a typical Round; a longer one takes an honest gap. */
export const HOLD_BUDGET_MS = 45 * 60_000;
/** A check that keeps failing must not block: the deploy goes without it. */
const MAX_FAILED_CHECKS = 3;
const CHECK_TIMEOUT_MS = 60_000;

export type HoldState = {
  readonly elapsedMs: number;
  readonly failedChecks: number;
};
export type HoldStep =
  | { readonly kind: 'wait' }
  | {
      readonly kind: 'deploy';
      readonly reason: 'idle' | 'budget' | 'check-failed';
    };

/** One reading's decision. `live` is null when the check itself failed. */
export function holdStep(state: HoldState, live: number | null): HoldStep {
  if (live === 0) return { kind: 'deploy', reason: 'idle' };
  if (live === null && state.failedChecks + 1 >= MAX_FAILED_CHECKS)
    return { kind: 'deploy', reason: 'check-failed' };
  if (state.elapsedMs >= HOLD_BUDGET_MS)
    return { kind: 'deploy', reason: 'budget' };
  return { kind: 'wait' };
}

/** The count a check printed, or null for anything else. */
export function parseLiveCount(output: string): number | null {
  const line = output.trim().split('\n').at(-1)?.trim() ?? '';
  return /^\d+$/.test(line) ? Number(line) : null;
}

export async function runHold(input: {
  readonly check: () => Promise<number | null>;
  readonly nowMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly report: (line: string) => void;
}) {
  const startedAt = input.nowMs();
  let failedChecks = 0;
  for (;;) {
    const live = await input.check().catch(() => null);
    const elapsedMs = input.nowMs() - startedAt;
    const step = holdStep({ elapsedMs, failedChecks }, live);
    if (step.kind === 'deploy') {
      input.report(JSON.stringify({ reason: step.reason, elapsedMs, live }));
      return step.reason;
    }
    failedChecks = live === null ? failedChecks + 1 : 0;
    await input.sleep(POLL_MS);
  }
}

async function checkOnWorker(app: string) {
  const child = Bun.spawn(
    [
      'flyctl',
      'ssh',
      'console',
      '-a',
      app,
      '-C',
      'bun /app/apps/media-worker/src/capture-count.ts',
    ],
    {
      stdout: 'pipe',
      stderr: 'ignore',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    },
  );
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return code === 0 ? parseLiveCount(output) : null;
}

if (import.meta.main) {
  const app = Bun.argv[2];
  if (!app) throw new Error('Name the capture worker app');
  await runHold({
    check: () => checkOnWorker(app),
    nowMs: () => performance.now(),
    sleep: (ms) => Bun.sleep(ms),
    report: (line) => process.stdout.write(`${line}\n`),
  });
}
