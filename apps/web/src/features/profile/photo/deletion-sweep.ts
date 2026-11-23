import { repeatEvery } from '@daisy/worker';
import type { Waits } from '@daisy/clock';
import type { Clock } from '@daisy/clock';
import type { PhotoDeletion } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createScheduledWorker } from '../../ops/scheduled-worker';
import type { ProfilePhotoObjects } from './ports';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH = 50;
const RETRY_MS = 60_000;
const RETRY_MAX_MS = 3_600_000;

/** A failed deletion waits a minute, doubling, at most an hour. */
export const photoDeletionRetryAt = (now: string, attempts: number): string =>
  new Date(
    new Date(now).getTime() +
      Math.min(RETRY_MS * 2 ** Math.max(0, attempts), RETRY_MAX_MS),
  ).toISOString();

export type PhotoDeletionStore = {
  readonly due: (input: {
    readonly now: string;
    readonly limit: number;
  }) => Promise<readonly PhotoDeletion[]>;
  readonly complete: (photoId: string) => Promise<void>;
  readonly defer: (photoId: string, retryAt: string) => Promise<void>;
  /** The backlog at `now`, the pass's own clock, so due and owed agree. */
  readonly owed: (now: string) => Promise<number>;
};

/**
 * One pass: every due terminal photo's image is deleted, then its row. A
 * storage failure, or no storage configured, leaves the row owed with
 * backoff. Each photo is tried even when an earlier one failed. Counts only
 * are reported; no photo id or key reaches a log.
 */
export async function sweepPhotoDeletions(
  now: string,
  store: PhotoDeletionStore,
  objects: ProfilePhotoObjects | null,
): Promise<{ deleted: number; retried: number; owed: number }> {
  const due = await store.due({ now, limit: SWEEP_BATCH });
  let deleted = 0;
  let retried = 0;
  for (const photo of due) {
    try {
      if (!objects) throw new Error('no profile photo storage');
      await objects.removePrefix(photo.objectPrefix);
      await store.complete(photo.photoId);
      deleted += 1;
    } catch {
      // A failed defer leaves the row due now, still owed: the next pass
      // tries it again. It never stops this pass short.
      await store
        .defer(photo.photoId, photoDeletionRetryAt(now, photo.attempts))
        .catch(() => undefined);
      retried += 1;
    }
  }
  return { deleted, retried, owed: await store.owed(now) };
}

/**
 * The scheduled sweep (ADR 0143): rejected, removed, withdrawn and erased
 * photos, and uploads that never finished within their reservation.
 */
export function startPhotoDeletions(input: {
  readonly store: PhotoDeletionStore;
  readonly objects: ProfilePhotoObjects | null;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly waits: Waits;
}) {
  const work = createScheduledWorker({
    name: 'profile_photo_deletions',
    clock: input.clock,
    logger: input.logger,
    pass: (now) => sweepPhotoDeletions(now, input.store, input.objects),
  });
  return repeatEvery({
    run: () => work.run(),
    waits: input.waits,
    everyMs: SWEEP_INTERVAL_MS,
    runOnStart: true,
    // Each run reports its own failure.
    failed: () => undefined,
  });
}
