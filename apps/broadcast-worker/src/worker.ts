import type { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import {
  broadcastHoldPrefix,
  broadcastLivePrefix,
  holdAttemptPrefix,
  stageTimeline,
} from '@daisy/protocol';
import { encoderArgs, silentEncoderArgs, slateEncoderArgs } from './encoder';
import { masterPlaylist, RENDITIONS } from './hold-manifest';
import type { createObjects } from './objects';
import { releaseStep } from './release-step';
import { feedWithdrawalPorts, withdrawFeed } from './withdrawal';

const LEASE_MS = 30_000;
const RENEW_MS = 5_000;
const IDLE_MS = 500;
/** A clip this many times unreadable is given up on, with a growing wait between. */
const CLIP_ATTEMPTS = 5;
const CLIP_RETRY_MS = 1000;
/** A 4 s segment encodes in well under this; past it the encoder is hung. */
const ENCODE_TIMEOUT_MS = 60_000;

/** This clip itself cannot be made, unlike an outage, which is retried for as long as it lasts. */
class UnreadableClip extends Error {}
/** The lease is gone or going: nothing more may reach the public bucket. */
class LeaseEnded extends Error {}

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
    event:
      | 'broadcast.release_failed'
      | 'broadcast.release_lapsed'
      | 'broadcast.clip_skipped',
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
      let lapsedSaid = false;
      let passedThroughMs = 0;
      let skipped = job.releaseSkips.clips;
      const clipFailures = new Map<number, number>();
      let leaseUntilMs = deps.now() + LEASE_MS;
      let leaseEnded = false;
      let finished = false;
      // Apart from the steps, so a long step cannot outlast the lease, and a stop or a
      // lost lease stops the encoder at once rather than at the step's end.
      const stepping = new AbortController();
      const renewing = (async () => {
        let renewedAt = deps.now();
        while (!finished) {
          await deps.sleep(RENEW_MS);
          if (finished || deps.now() - renewedAt < RENEW_MS) continue;
          const row = await store
            .renew({
              id: job.id,
              owner: deps.owner,
              epoch: job.leaseEpoch,
              leaseUntil: new Date(deps.now() + LEASE_MS),
            })
            .catch(() => undefined);
          if (row === undefined) {
            deps.report('broadcast.release_failed');
            continue;
          }
          if (row === null) leaseEnded = true;
          else {
            facts = row;
            renewedAt = deps.now();
            leaseUntilMs = renewedAt + LEASE_MS;
          }
          if (row === null || row.stoppedAt !== null) stepping.abort();
        }
      })();
      /** Checked before each public write: a takedown must never be undone by a late one. */
      const ensureLease = () => {
        if (leaseEnded || stepping.signal.aborted || deps.now() >= leaseUntilMs)
          throw new LeaseEnded();
      };
      while (!deps.stopped() && facts.completedAt === null && !leaseEnded) {
        let encoded = false;
        let attempting: number | null = null;
        // A failed step keeps the job: dropping it waits out this worker's own lease.
        try {
          if (facts.stoppedAt !== null) {
            await withdrawFeed(facts, feedWithdrawalPorts(job.id, deps));
            break;
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
              skippedClips: skipped,
              nowMs: deps.now(),
              roundEndedAtMs: facts.finalMediaEndAt?.getTime() ?? null,
              finalMediaEndMs: facts.finalMediaEndAt?.getTime() ?? null,
              heartbeatMs: facts.controlHeartbeatAt?.getTime() ?? null,
              releasedThroughMs: Math.max(
                facts.releasedThroughAt?.getTime() ?? 0,
                passedThroughMs,
              ),
              stage: stageTimeline({
                ...(await store.readStageHistory(job.id)),
                knownThroughMs: facts.controlHeartbeatAt?.getTime() ?? null,
                captureFromMs: facts.createdAt.getTime(),
              }),
            },
            {
              readHoldPlaylist: () => objects.readHoldText(`${hold}p.m3u8`),
              encode: async (clip) => {
                encoded = true;
                attempting = clip.capturedAtMs;
                const { source, interval, capturedAtMs, offsetMs, durationMs } =
                  clip;
                const { name } = source;
                const input = `${dir}/${name}`;
                const output = (r: string) => `${dir}/${capturedAtMs}-${r}.ts`;
                await objects.ensureDir(dir);
                if (interval.kind !== 'private') {
                  if (!(await objects.holdExists(`${hold}${name}`)))
                    throw new UnreadableClip();
                  await objects.copyHoldToFile(`${hold}${name}`, input);
                }
                const whole = durationMs === source.durationMs;
                const args =
                  interval.kind === 'private'
                    ? slateEncoderArgs(output, capturedAtMs, durationMs)
                    : interval.kind === 'between'
                      ? silentEncoderArgs(input, output, capturedAtMs, {
                          offsetMs,
                          durationMs,
                        })
                      : encoderArgs(
                          input,
                          output,
                          capturedAtMs,
                          whole ? undefined : { offsetMs, durationMs },
                        );
                const code = await Bun.spawn([...args], {
                  stderr: 'ignore',
                  signal: AbortSignal.any([
                    stepping.signal,
                    AbortSignal.timeout(ENCODE_TIMEOUT_MS),
                  ]),
                }).exited;
                ensureLease();
                if (code !== 0) throw new UnreadableClip();
                return RENDITIONS.map((r) => ({
                  rendition: r.name,
                  file: output(r.name),
                }));
              },
              publishSegment: async (seq, rendition, file) => {
                ensureLease();
                await objects.putSegment(
                  `${live}${rendition}/seg-${seq}.ts`,
                  file,
                );
              },
              publishManifest: async (key, text) => {
                ensureLease();
                await objects.putManifest(`${live}${key}`, text);
              },
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
                  generation,
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
        } catch (error) {
          if (!(error instanceof LeaseEnded)) {
            deps.report('broadcast.release_failed');
            const clipMs = attempting;
            if (error instanceof UnreadableClip && clipMs !== null) {
              const attempts = (clipFailures.get(clipMs) ?? 0) + 1;
              clipFailures.set(clipMs, attempts);
              if (attempts >= CLIP_ATTEMPTS) {
                await store.recordSkipped({
                  id: job.id,
                  owner: deps.owner,
                  epoch: job.leaseEpoch,
                  capturedAtMs: clipMs,
                });
                skipped = [...skipped, clipMs];
                deps.report('broadcast.clip_skipped');
              } else await deps.sleep(CLIP_RETRY_MS * 2 ** (attempts - 1));
            } else await deps.sleep(IDLE_MS);
          }
        } finally {
          if (encoded)
            await scratch
              .clear(job.id)
              .catch(() => deps.report('broadcast.release_failed'));
        }
      }
      finished = true;
      await renewing;
    } catch {
      deps.report('broadcast.release_failed');
      await deps.sleep(IDLE_MS);
    }
  }
};
