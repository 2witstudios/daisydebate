import type { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import {
  broadcastHoldPrefix,
  broadcastLivePrefix,
  holdAttemptPrefix,
  publicIntervals,
} from '@daisy/protocol';
import { encoderArgs } from './encoder';
import { masterPlaylist, RENDITIONS } from './hold-manifest';
import type { createObjects } from './objects';
import { releaseStep } from './release-step';
import { feedWithdrawalPorts, withdrawFeed } from './withdrawal';

const LEASE_MS = 30_000;
const RENEW_MS = 5_000;
const IDLE_MS = 500;

/**
 * One slot: claims a releasing Broadcast and holds it until it completes, renewing
 * the lease and reading fresh facts as it goes. A stop seen at renewal is withdrawn
 * here; an unheld one goes to `runFeedWithdrawals`. A crash loses nothing: the cursor is
 * durable, another slot takes over after the lease, and the same segment is
 * simply released again. Run several slots per machine.
 */
export const runWorker = async (deps: {
  readonly owner: string;
  readonly store: ReturnType<typeof createBroadcastWorkerStore>;
  readonly objects: ReturnType<typeof createObjects>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly report: (
    event: 'broadcast.release_failed' | 'broadcast.release_lapsed',
  ) => void;
  /** Where one Broadcast's segments sit while encoding; emptied after each step. */
  readonly scratch: {
    readonly dir: (broadcastId: string) => string;
    readonly clear: (broadcastId: string) => Promise<void>;
  };
}) => {
  const { store, objects, scratch } = deps;
  while (!deps.stopped()) {
    // A database blip must not end this slot: report it and try again.
    const job = await store
      .claim({
        owner: deps.owner,
        now: new Date(deps.now()),
        leaseUntil: new Date(deps.now() + LEASE_MS),
      })
      .catch(() => {
        deps.report('broadcast.release_failed');
        return null;
      });
    if (!job) {
      await deps.sleep(IDLE_MS);
      continue;
    }
    const live = broadcastLivePrefix(job.feedKey);
    const dir = scratch.dir(job.id);
    try {
      // A crashed owner's leftovers go first: the disk outlasts the process.
      await scratch.clear(job.id);
      await objects.putManifest(`${live}master.m3u8`, masterPlaylist());
      let next = job.nextSegment;
      let cursor = job.holdCursor;
      let generation = job.releasedGeneration;
      let facts = job;
      let renewedAt = deps.now();
      let lapsedSaid = false;
      let passedThroughMs = 0;
      while (!deps.stopped() && facts.completedAt === null) {
        let encoded = false;
        // A failed step keeps the job: dropping it waits out this worker's own lease.
        try {
          if (deps.now() - renewedAt >= RENEW_MS) {
            const row = await store.renew({
              id: job.id,
              owner: deps.owner,
              epoch: job.leaseEpoch,
              leaseUntil: new Date(deps.now() + LEASE_MS),
            });
            if (!row) break;
            facts = row;
            renewedAt = deps.now();
            if (facts.stoppedAt !== null) {
              await withdrawFeed(facts, feedWithdrawalPorts(job.id, deps));
              break;
            }
          }
          const hold = holdAttemptPrefix(
            broadcastHoldPrefix(job.id),
            generation,
          );
          const result = await releaseStep(
            {
              policy: facts.releasePolicy,
              nextSegment: next,
              holdCursor: cursor,
              attemptIndex: generation - 1,
              laterAttemptStartedMs:
                facts.egressGeneration > generation
                  ? (facts.egressStartedAt?.getTime() ?? 0)
                  : null,
              streamEnded: facts.streamEndedAt !== null,
              nowMs: deps.now(),
              finalMediaEndMs: facts.finalMediaEndAt?.getTime() ?? null,
              heartbeatMs: facts.controlHeartbeatAt?.getTime() ?? null,
              releasedThroughMs: Math.max(
                facts.releasedThroughAt?.getTime() ?? 0,
                passedThroughMs,
              ),
              publicIntervals: publicIntervals(
                await store.readPublicHistory(job.id),
                facts.controlHeartbeatAt?.getTime() ?? null,
              ),
            },
            {
              readHoldPlaylist: () => objects.readHoldText(`${hold}p.m3u8`),
              encode: async ({
                source,
                offsetMs,
                capturedAtMs,
                durationMs,
              }) => {
                encoded = true;
                const { name } = source;
                const input = `${dir}/${name}`;
                const output = (r: string) => `${dir}/${r}.ts`;
                await objects.copyHoldToFile(`${hold}${name}`, input);
                const code = await Bun.spawn(
                  [
                    ...encoderArgs(
                      input,
                      output,
                      capturedAtMs,
                      durationMs === source.durationMs
                        ? undefined
                        : { offsetMs, durationMs },
                    ),
                  ],
                  {
                    stderr: 'ignore',
                  },
                ).exited;
                if (code !== 0) throw new Error(`encoder exited ${code}`);
                return RENDITIONS.map((r) => ({
                  rendition: r.name,
                  file: output(r.name),
                }));
              },
              publishSegment: (seq, rendition, file) =>
                objects.putSegment(`${live}${rendition}/seg-${seq}.ts`, file),
              publishManifest: (key, text) =>
                objects.putManifest(`${live}${key}`, text),
              recordReleased: (segment, mediaEndMs) =>
                store.recordReleased({
                  id: job.id,
                  owner: deps.owner,
                  epoch: job.leaseEpoch,
                  segment,
                  mediaEnd: new Date(mediaEndMs),
                }),
              recordPassed: async (throughMs) => {
                const held = await store.recordPassed({
                  id: job.id,
                  owner: deps.owner,
                  epoch: job.leaseEpoch,
                  through: new Date(throughMs),
                });
                passedThroughMs = throughMs;
                return held;
              },
              recordEnded: (mediaEndMs) =>
                store.recordEnded({
                  id: job.id,
                  owner: deps.owner,
                  epoch: job.leaseEpoch,
                  mediaEnd: new Date(mediaEndMs),
                  now: new Date(deps.now()),
                }),
              recordAdvanced: () =>
                store.recordAdvanced({
                  id: job.id,
                  owner: deps.owner,
                  epoch: job.leaseEpoch,
                }),
            },
          );
          if (result.kind === 'fenced') break;
          if (result.kind === 'lapsed') {
            if (!lapsedSaid) deps.report('broadcast.release_lapsed');
            lapsedSaid = true;
          } else lapsedSaid = false;
          if (result.kind === 'released') {
            next += 1;
            cursor += 1;
          } else if (result.kind === 'advanced') {
            generation += 1;
            cursor = 0;
          } else if (result.kind === 'ended')
            facts = { ...facts, streamEndedAt: new Date(deps.now()) };
          else await deps.sleep(IDLE_MS);
        } catch {
          deps.report('broadcast.release_failed');
          await deps.sleep(IDLE_MS);
        } finally {
          if (encoded)
            await scratch
              .clear(job.id)
              .catch(() => deps.report('broadcast.release_failed'));
        }
      }
    } catch {
      deps.report('broadcast.release_failed');
      await deps.sleep(IDLE_MS);
    }
  }
};
