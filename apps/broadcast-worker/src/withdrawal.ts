import { RENDITIONS } from './hold-manifest';

/**
 * Every public object a stopped Broadcast can have, manifests first so no
 * player is told about a segment already gone. `nextSegment` is included: a
 * crash can publish a segment before the cursor moves past it.
 */
export const withdrawalKeys = (
  broadcastId: string,
  nextSegment: number,
): readonly string[] => {
  const live = `live/${broadcastId}/`;
  const seqs = Array.from({ length: nextSegment + 1 }, (_, seq) => seq);
  return [
    `${live}master.m3u8`,
    ...RENDITIONS.map(({ name }) => `${live}${name}/index.m3u8`),
    ...RENDITIONS.flatMap(({ name }) =>
      seqs.map((seq) => `${live}${name}/seg-${seq}.ts`),
    ),
  ];
};

type StoppedJob = {
  readonly id: string;
  readonly nextSegment: number;
  readonly finalMediaEndAt: Date | null;
};

/**
 * An operator stopped this Broadcast (WATCH-7): nothing more is released and
 * what was public goes. It completes only once the reconciler has recorded
 * that the Egress is gone, because a completed Broadcast is reconciled no more.
 * Safe to repeat: deleting what is already gone is not an error.
 */
export const withdrawStopped = async (
  job: StoppedJob,
  ports: {
    readonly deletePublic: (key: string) => Promise<void>;
    readonly complete: () => Promise<void>;
  },
): Promise<void> => {
  for (const key of withdrawalKeys(job.id, job.nextSegment))
    await ports.deletePublic(key);
  if (job.finalMediaEndAt !== null) await ports.complete();
};
