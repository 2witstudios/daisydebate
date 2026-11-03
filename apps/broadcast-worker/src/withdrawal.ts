import { broadcastLivePrefix, officialFeedPath } from '@daisy/protocol';
import { RENDITIONS } from './hold-manifest';

/**
 * A finished Broadcast's public objects stay this long after completion, so a
 * viewer can finish the last segments. It is shorter than OBS's wait before it
 * reopens an ended feed (about 15 s after the end, measured on OBS 32.1.2), so
 * a streamer's Media Source finds nothing to play again.
 */
export const FEED_END_GRACE_MS = 10_000;

/**
 * Every public object a Broadcast can have, manifests first so no player is told
 * about a segment already gone. `nextSegment` is included: a crash can publish a
 * segment before the cursor moves past it.
 */
export const withdrawalKeys = (
  broadcastId: string,
  nextSegment: number,
): readonly string[] => {
  const live = broadcastLivePrefix(broadcastId);
  const seqs = Array.from({ length: nextSegment + 1 }, (_, seq) => seq);
  return [
    officialFeedPath(broadcastId),
    ...RENDITIONS.map(({ name }) => `${live}${name}/index.m3u8`),
    ...RENDITIONS.flatMap(({ name }) =>
      seqs.map((seq) => `${live}${name}/seg-${seq}.ts`),
    ),
  ];
};

type FinishedJob = {
  readonly id: string;
  readonly nextSegment: number;
  readonly finalMediaEndAt: Date | null;
  readonly completedAt: Date | null;
};

/**
 * The feed ends: an operator stopped this Broadcast (WATCH-7), or it completed
 * and its grace passed. Either way nothing public stays, so a finished feed
 * cannot replay and a later takedown has no public copy left behind. A stopped
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
  for (const key of withdrawalKeys(job.id, job.nextSegment))
    await ports.deletePublic(key);
  await ports.recordWithdrawn();
  if (job.completedAt === null && job.finalMediaEndAt !== null)
    await ports.complete();
};
