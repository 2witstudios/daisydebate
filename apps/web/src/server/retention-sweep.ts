import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { RetentionTarget } from './retention-target';

export type RetentionResult = {
  readonly operation: string;
  readonly ok: boolean;
  /** False when the last batch was full at `maxBatches`: due rows remain. */
  readonly drained: boolean;
  readonly deleted: number;
  readonly batches: number;
};

/**
 * The one bounded, idempotent retention sweep (ISSUE-8 AC5): each target in
 * turn, in batches of its `batchSize` until a short batch or its
 * `maxBatches`, with one clock reading per run. A failing target is logged
 * and the sweep moves to the next, so one broken store never stops the
 * others. Only counts and a stable error code are logged, never row
 * content or the error.
 *
 * `retention.run.completed` is the run's own outcome and the only event the
 * `cleanup_missed` marker reads (ISSUE-1007): logged once, and only when
 * every target succeeded and drained and shutdown cut nothing short. A target
 * that stops at `maxBatches` still has due rows, so that run did not complete.
 */
export function createRetentionSweep({
  targets,
  clock,
  logger,
}: {
  readonly targets: readonly RetentionTarget[];
  readonly clock: Clock;
  readonly logger: Logger;
}) {
  const sweepTarget = async (
    target: RetentionTarget,
    now: string,
    signal: AbortSignal,
  ): Promise<RetentionResult> => {
    const operation = target.name;
    let deleted = 0;
    let batches = 0;
    let drained = false;
    try {
      while (!signal.aborted && batches < target.maxBatches) {
        const count = await target.purge({ now, limit: target.batchSize });
        batches += 1;
        deleted += count;
        drained = count < target.batchSize;
        if (drained) break;
      }
    } catch {
      logger.log(
        'retention.sweep.failed',
        { operation, errorCode: 'INFRASTRUCTURE' },
        'Retention sweep failed',
      );
      return { operation, ok: false, drained: false, deleted, batches };
    }
    logger.log(
      'retention.sweep.completed',
      { operation, deleted, batches },
      'Retention sweep completed',
    );
    return { operation, ok: true, drained, deleted, batches };
  };
  return {
    /** `signal` ends a run between batches, so shutdown never closes a pool under it. */
    async run(
      signal: AbortSignal = new AbortController().signal,
    ): Promise<readonly RetentionResult[]> {
      const now = clock.now();
      const results: RetentionResult[] = [];
      for (const target of targets) {
        if (signal.aborted) break;
        results.push(await sweepTarget(target, now, signal));
      }
      if (!signal.aborted && results.every(({ ok, drained }) => ok && drained))
        logger.log(
          'retention.run.completed',
          { deleted: results.reduce((sum, { deleted }) => sum + deleted, 0) },
          'Retention run completed',
        );
      return results;
    },
  };
}
