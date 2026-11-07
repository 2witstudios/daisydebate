import { canReleaseFreeJudgeBinding } from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';

/** One bounded page per tick; a failed identity cannot starve later abandoned Rounds. */
export function createUsageRecovery(input: {
  readonly store: Pick<
    Database,
    'readAbandonedUsageCandidates' | 'releaseAbandonedUsage'
  >;
  readonly instanceId: string;
  readonly failed: (error: unknown, stage: 'discover' | 'release') => void;
}) {
  let afterId: string | undefined;
  let stopped = false;
  return {
    async run() {
      if (stopped) return;
      try {
        const page = await input.store.readAbandonedUsageCandidates({
          instanceId: input.instanceId,
          ...(afterId === undefined ? {} : { afterId }),
          limit: 25,
        });
        for (const candidate of page.candidates) {
          if (stopped) return;
          try {
            await input.store.releaseAbandonedUsage(
              { ...candidate, instanceId: input.instanceId },
              canReleaseFreeJudgeBinding,
            );
          } catch (error) {
            input.failed(error, 'release');
          }
        }
        afterId = page.exhausted ? undefined : (page.afterId ?? undefined);
      } catch (error) {
        input.failed(error, 'discover');
      }
    },
    stop() {
      stopped = true;
    },
  };
}
