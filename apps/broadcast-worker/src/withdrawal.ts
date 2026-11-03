import { broadcastLivePrefix, officialFeedPath } from '@daisy/protocol';
import { RENDITIONS } from './hold-manifest';

/**
 * A finished Broadcast's public objects stay this long after completion, for its
 * viewers: one completes about 62 s after media ends and real viewers sit 70 to
 * 75 s behind, so they reach the end about 13 s after completion, and one who
 * stalled needs longer. A streamer's OBS reopens the ended feed in that time and
 * replays the last 24 s until this passes, so Stream this Round says to stop the
 * source when the Round ends.
 */
export const FEED_END_GRACE_MS = 60_000;

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
 * gone, because a completed Broadcast is reconciled no more. Safe to repeat:
 * deleting what is already gone is not an error.
 */
export const withdrawFeed = async (
  job: FinishedJob,
  ports: {
    readonly deletePublic: (key: string) => Promise<void>;
    readonly recordWithdrawn: () => Promise<void>;
    readonly complete: () => Promise<void>;
  },
): Promise<void> => {
  for (const key of withdrawalKeys(job.feedKey, job.nextSegment))
    await ports.deletePublic(key);
  await ports.recordWithdrawn();
  if (job.completedAt === null && job.finalMediaEndAt !== null)
    await ports.complete();
};
