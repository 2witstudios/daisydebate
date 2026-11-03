import type { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import {
  broadcastHoldPrefix,
  broadcastLivePrefix,
  officialFeedPath,
} from '@daisy/protocol';
import { RENDITIONS } from './hold-manifest';
import type { createObjects } from './objects';

/**
 * A finished Broadcast's public objects stay this long after completion, for its
 * viewers: one completes about 62 s after media ends and real viewers sit 70 to
 * 75 s behind, so they reach the end about 13 s after completion, and one who
 * stalled needs longer. A streamer's OBS reopens the ended feed in that time and
 * replays the last 24 s until this passes, so Stream this Round says to stop the
 * source when the Round ends.
 */
export const FEED_END_GRACE_MS = 60_000;

/** Deletes at once: two hours of segments are gone in seconds, not minutes. */
const DELETE_BATCH = 32;
const WITHDRAWAL_LEASE_MS = 30_000;
const IDLE_MS = 500;
/** Egress finishes writing its last segments this long after a stop (measured: 2 s). */
const HOLD_SETTLE_MS = 10_000;

/**
 * Every public object a Broadcast can have, manifests first so no player is told
 * about a segment already gone. `nextSegment` is included: a crash can publish a
 * segment before the cursor moves past it.
 */
export const withdrawalKeys = (
  feedKey: string,
  nextSegment: number,
): readonly string[] => {
  const live = broadcastLivePrefix(feedKey);
  const seqs = Array.from({ length: nextSegment + 1 }, (_, seq) => seq);
  return [
    officialFeedPath(feedKey),
    ...RENDITIONS.map(({ name }) => `${live}${name}/index.m3u8`),
    ...RENDITIONS.flatMap(({ name }) =>
      seqs.map((seq) => `${live}${name}/seg-${seq}.ts`),
    ),
  ];
};

type FinishedJob = {
  readonly feedKey: string;
  readonly nextSegment: number;
  readonly finalMediaEndAt: Date | null;
  readonly completedAt: Date | null;
};

/**
 * The feed ends: an operator stopped this Broadcast (WATCH-7), or it completed
 * and its grace passed. Either way nothing public stays, so a finished feed
 * stops replaying and a later takedown has no public copy left behind. A stopped
 * Broadcast completes only once the reconciler has recorded that the Egress is
 * gone, because a completed Broadcast is reconciled no more. The hold goes with it
 * when no Recording will read it: the Recording worker clears a hold it read, and
 * nothing else would clear this one. Safe to repeat:
 * deleting what is already gone is not an error.
 */
export const withdrawFeed = async (
  job: FinishedJob,
  ports: {
    readonly deletePublic: (key: string) => Promise<void>;
    readonly recordWithdrawn: () => Promise<void>;
    readonly complete: () => Promise<void>;
    /** Whether a Recording will read, and later clear, this Broadcast's hold. */
    readonly recordingKeepsHold: () => Promise<boolean>;
    /** One bounded page of deletes from the hold; zero means it lists empty. */
    readonly discardHoldPage: () => Promise<number>;
    readonly nowMs: () => number;
  },
): Promise<void> => {
  const keys = withdrawalKeys(job.feedKey, job.nextSegment);
  const manifests = keys.filter((key) => key.endsWith('.m3u8'));
  await Promise.all(manifests.map(ports.deletePublic));
  const segments = keys.filter((key) => !key.endsWith('.m3u8'));
  for (let at = 0; at < segments.length; at += DELETE_BATCH)
    await Promise.all(
      segments.slice(at, at + DELETE_BATCH).map(ports.deletePublic),
    );
  const endMs = job.finalMediaEndAt?.getTime() ?? null;
  // Nothing more is coming once the Egress has had time to finish writing. A stop
  // too recent comes back here when its lease ends, not yet complete.
  const settled = endMs !== null && ports.nowMs() >= endMs + HOLD_SETTLE_MS;
  if (settled && !(await ports.recordingKeepsHold()))
    while ((await ports.discardHoldPage()) > 0);
  await ports.recordWithdrawn();
  if (job.completedAt === null && settled) await ports.complete();
};

type WithdrawalDeps = {
  readonly store: ReturnType<typeof createBroadcastWorkerStore>;
  readonly objects: ReturnType<typeof createObjects>;
  readonly now: () => number;
};

/** What withdrawing this Broadcast touches, for whichever loop holds it. */
export const feedWithdrawalPorts = (id: string, deps: WithdrawalDeps) => ({
  deletePublic: (key: string) => deps.objects.deletePublic(key),
  recordWithdrawn: async () => {
    await deps.store.recordFeedWithdrawn({ id, at: new Date(deps.now()) });
  },
  complete: async () => {
    await deps.store.complete({ id, at: new Date(deps.now()) });
  },
  recordingKeepsHold: () => deps.store.recordingKeepsHold(id),
  discardHoldPage: () => deps.objects.discardHoldPage(broadcastHoldPrefix(id)),
  nowMs: deps.now,
});

/**
 * Takes feeds down, one per machine and apart from the release slots: a slot is
 * held for a whole Round, and a takedown must not wait for one. It never encodes,
 * so it is free unless it is already deleting another feed.
 */
export const runFeedWithdrawals = async (
  deps: WithdrawalDeps & {
    readonly owner: string;
    readonly sleep: (ms: number) => Promise<void>;
    readonly stopped: () => boolean;
    readonly report: (event: 'broadcast.withdrawal_failed') => void;
  },
) => {
  while (!deps.stopped()) {
    try {
      const job = await deps.store.claimWithdrawal({
        owner: deps.owner,
        now: new Date(deps.now()),
        leaseUntil: new Date(deps.now() + WITHDRAWAL_LEASE_MS),
        withdrawFinishedBefore: new Date(deps.now() - FEED_END_GRACE_MS),
      });
      if (job) await withdrawFeed(job, feedWithdrawalPorts(job.id, deps));
      else await deps.sleep(IDLE_MS);
    } catch {
      deps.report('broadcast.withdrawal_failed');
      await deps.sleep(IDLE_MS);
    }
  }
};
