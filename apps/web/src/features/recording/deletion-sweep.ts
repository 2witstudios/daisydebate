import { recordingObjectPrefix, transitionRecording } from '@daisy/protocol';
import type { RecordingObjectStore, RecordingStore } from './ports';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A capture still writing when removal was asked gets this long to stop. */
export const REMOVAL_SETTLE_MS = HOUR_MS;
/** Partial objects of a failed capture go after this; no video survives a failure. */
export const FAILED_CAPTURE_RETENTION_MS = 7 * DAY_MS;

const DELETIONS_PER_RUN = 16;
const KEYS_PER_DELETION = 500;
const LEASE_MS = 5 * MINUTE_MS;

/** A failed deletion retries from one minute, doubling, at most hourly. */
export const deletionRetryAt = (nowMs: number, attempts: number): string =>
  new Date(
    nowMs + Math.min(MINUTE_MS * 2 ** Math.min(attempts, 16), HOUR_MS),
  ).toISOString();

export type DeletionSweepResult = {
  readonly removedRecordings: number;
  readonly removedKeys: number;
  readonly deferred: number;
  readonly failedCleanups: number;
};

const queueFailedCleanups = async (
  store: RecordingStore,
  nowMs: number,
): Promise<number> => {
  const ids = await store.listFailedBefore({
    before: new Date(nowMs - FAILED_CAPTURE_RETENTION_MS).toISOString(),
    limit: DELETIONS_PER_RUN,
  });
  const at = new Date(nowMs).toISOString();
  await Promise.all(
    ids.map((id) =>
      store.apply(id, (record) =>
        transitionRecording(record, {
          type: 'removal_requested',
          cause: 'failed_capture_cleanup',
          at,
        }),
      ),
    ),
  );
  return ids.length;
};

/** Pays the removals an evidence hold owed, now the report closed or time ran out. */
const payEndedEvidenceHolds = async (store: RecordingStore, nowMs: number) => {
  const ids = await store.listEndedEvidenceHolds({
    now: new Date(nowMs).toISOString(),
    limit: DELETIONS_PER_RUN,
  });
  await Promise.all(
    ids.map((id) =>
      store.apply(id, (record) =>
        transitionRecording(record, { type: 'evidence_hold_ended' }),
      ),
    ),
  );
};

const settled = (requestedAt: string, nowMs: number): boolean =>
  nowMs - Date.parse(requestedAt) >= REMOVAL_SETTLE_MS;

/**
 * One bounded run. The intent is durable, so a vendor outage or a dead process
 * only delays deletion. A Recording ends as removed only after listing its prefix
 * finds nothing left, once capture has had time to stop writing and the worker
 * has cleared its sources from the hold bucket. Safe to repeat.
 */
export const runDeletionSweep = async (deps: {
  readonly store: RecordingStore;
  readonly objects: RecordingObjectStore;
  readonly owner: string;
  readonly nowMs: number;
}): Promise<DeletionSweepResult> => {
  const { store, objects, nowMs } = deps;
  const failedCleanups = await queueFailedCleanups(store, nowMs);
  await payEndedEvidenceHolds(store, nowMs);
  const claims = await store.claimDeletions({
    owner: deps.owner,
    now: new Date(nowMs).toISOString(),
    leaseUntil: new Date(nowMs + LEASE_MS).toISOString(),
    limit: DELETIONS_PER_RUN,
  });
  let removedRecordings = 0;
  let removedKeys = 0;
  let deferred = 0;
  for (const { record, attempts } of claims) {
    try {
      const keys = await objects.listKeys(
        recordingObjectPrefix(record.id),
        KEYS_PER_DELETION,
      );
      if (keys.length > 0) {
        await objects.removeKeys(keys);
        removedKeys += keys.length;
      }
      const status = record.lifecycle;
      // The sources sit in another bucket: removed means they are gone too.
      if (
        keys.length === 0 &&
        status.status === 'removing' &&
        settled(status.requestedAt, nowMs) &&
        !(await store.sourcesRemain(record.id))
      ) {
        await store.apply(record.id, (current) =>
          transitionRecording(current, {
            type: 'objects_gone',
            at: new Date(nowMs).toISOString(),
          }),
        );
        removedRecordings += 1;
      } else if (keys.length === 0) {
        await store.deferDeletion(record.id, {
          retryAt: deletionRetryAt(nowMs, 5),
          failed: false,
        });
      } else {
        await store.deferDeletion(record.id, {
          retryAt: new Date(nowMs).toISOString(),
          failed: false,
        });
      }
    } catch {
      await store.deferDeletion(record.id, {
        retryAt: deletionRetryAt(nowMs, attempts),
        failed: true,
      });
      deferred += 1;
    }
  }
  return { removedRecordings, removedKeys, deferred, failedCleanups };
};
