import type { Clock } from '@daisy/clock';
import type { PhotoDeletion } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createScheduledWorker } from '../../ops/scheduled-worker';
import { startRunSchedule } from '../../../server/run-schedule';
import type { WorkerTimers } from '../../../lib/worker-timers';
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
  readonly owed: () => Promise<number>;
  readonly existing: (
    photoIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
};

/** Objects one reconcile pass reads; the walk resumes where it stopped. */
const RECONCILE_PAGE = 100;
/** An object this old with no row is an orphan, not an upload in flight. */
const ORPHAN_AFTER_MS = 3_600_000;

/** The photo id a stored key names, `profile-photos/<id>/<size>.webp`. */
const photoIdOfKey = (key: string): string | null =>
  /^profile-photos\/([a-z0-9]{24})\//u.exec(key)?.[1] ?? null;

/**
 * One reconcile step (ADR 0143): an upload whose row was never written and
 * whose cleanup also failed leaves objects no sweep would reach. Walk one page
 * of stored objects after `cursor`, and delete the prefix of every photo older
 * than an hour that no row names. Answers where the next step resumes; null
 * starts the walk again from the beginning.
 */
export async function reconcileOrphans(
  now: string,
  cursor: string | null,
  store: Pick<PhotoDeletionStore, 'existing'>,
  objects: ProfilePhotoObjects,
): Promise<{ readonly next: string | null; readonly orphans: number }> {
  const page = await objects.list(cursor, RECONCILE_PAGE);
  const cutoff = new Date(now).getTime() - ORPHAN_AFTER_MS;
  const aged = page.filter(
    (object) => new Date(object.writtenAt).getTime() < cutoff,
  );
  const ids = [
    ...new Set(
      aged
        .map((object) => photoIdOfKey(object.key))
        .filter((id) => id !== null),
    ),
  ];
  const existing = await store.existing(ids);
  const orphans = ids.filter((id) => !existing.has(id));
  for (const photoId of orphans)
    await objects.removePrefix(`profile-photos/${photoId}`);
  return {
    next: page.length < RECONCILE_PAGE ? null : (page.at(-1)?.key ?? null),
    orphans: orphans.length,
  };
}

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
      await store.defer(
        photo.photoId,
        photoDeletionRetryAt(now, photo.attempts),
      );
      retried += 1;
    }
  }
  return { deleted, retried, owed: await store.owed() };
}

/**
 * The scheduled sweep (ADR 0143): rejected, removed, withdrawn and erased
 * photos, then one step of the orphan reconcile.
 */
export function startPhotoDeletions(input: {
  readonly store: PhotoDeletionStore;
  readonly objects: ProfilePhotoObjects | null;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly timers: WorkerTimers;
}) {
  let cursor: string | null = null;
  return startRunSchedule({
    work: createScheduledWorker({
      name: 'profile_photo_deletions',
      clock: input.clock,
      logger: input.logger,
      pass: async (now) => {
        const swept = await sweepPhotoDeletions(
          now,
          input.store,
          input.objects,
        );
        if (!input.objects) return { ...swept, orphans: 0 };
        const reconciled = await reconcileOrphans(
          now,
          cursor,
          input.store,
          input.objects,
        );
        cursor = reconciled.next;
        return { ...swept, orphans: reconciled.orphans };
      },
    }),
    timers: input.timers,
    intervalMs: SWEEP_INTERVAL_MS,
    runOnStart: true,
  });
}
