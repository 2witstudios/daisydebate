import { deadlineSignal, type Waits } from '@daisy/clock';
import type { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import { holdLease, LeaseEnded, pollWork } from '@daisy/worker';
import { broadcastHoldPrefix } from '@daisy/protocol/broadcast-hold';
import { broadcastLivePrefix } from '@daisy/protocol/official-feed';
import { holdAttemptPrefix } from '@daisy/protocol/recording';
import { stageTimeline } from '@daisy/protocol/public-interval';
import { encoderArgs, silentEncoderArgs, slateEncoderArgs } from './encoder';
import { masterPlaylist, RENDITIONS } from './hold-manifest';
import type { createObjects } from './objects';
import { releaseStep } from './release-step';
import { feedWithdrawalPorts, withdrawFeed } from './withdrawal';

const LEASE_MS = 30_000;
const RENEW_MS = 5_000;
const IDLE_MS = 500;
/** An idle slot polls for a claim at most this rarely; a failing store backs off to it too. */
const IDLE_MAX_MS = 5_000;
/** Nothing due for longer than this gives the slot back: a long delay must not hold one. */
const PARK_AFTER_MS = 30_000;
/** A clip this many times unreadable is given up on, with a growing wait between. */
const CLIP_ATTEMPTS = 5;
const CLIP_RETRY_MS = 1000;
/** A 4 s segment encodes in well under this; past it the encoder is hung. */
const ENCODE_TIMEOUT_MS = 60_000;

/** This clip itself cannot be made, unlike an outage, which is retried for as long as it lasts. */
class UnreadableClip extends Error {}

/**
 * One slot: claims a releasing Broadcast and holds it until it completes, renewing
 * the lease and reading fresh facts as it goes. A stop seen at renewal is withdrawn
 * here; an unheld one goes to `runFeedWithdrawals`. A crash loses nothing: the cursor is
 * durable, another slot takes over after the lease, and the same segment is
 * simply released again. Run several slots per machine.
 */
export const startBroadcastSlot = (deps: {
  readonly owner: string;
  readonly store: ReturnType<typeof createBroadcastWorkerStore>;
  readonly objects: ReturnType<typeof createObjects>;
  /** Wall-clock milliseconds, for the instants the store records. */
  readonly now: () => number;
  /** Monotonic time and waits: the slot's pacing, its lease and its encoder bound. */
  readonly waits: Waits;
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
  const { store, objects, scratch, waits } = deps;
  type Job = NonNullable<Awaited<ReturnType<typeof store.claim>>>;
  /** Holds one claimed Broadcast until it completes, the lease ends or the slot stops. */
  const holdJob = async (job: Job, claimedAtMs: number, stop: AbortSignal) => {
    const live = broadcastLivePrefix(job.feedKey);
    const dir = scratch.dir(job.id);
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
    // A stop seen at renewal stops the encoder at once rather than at the step's end.
    const stopSeen = new AbortController();
    // Apart from the steps, so a long step cannot outlast the lease. A blip is
    // retried until the lease would lapse; the row it returns is the job's facts.
    const lease = holdLease({
      waits,
      facts: job,
      claimedAtMs,
      renewEveryMs: RENEW_MS,
      retryMs: RENEW_MS,
      horizonMs: LEASE_MS,
      renew: async () => {
        const row = await store.renew({
          id: job.id,
          owner: deps.owner,
          epoch: job.leaseEpoch,
          leaseUntil: new Date(deps.now() + LEASE_MS),
        });
        if (row === null) return { kind: 'lost', reason: 'taken' };
        if (row.stoppedAt !== null) stopSeen.abort();
        return { kind: 'held', facts: row };
      },
      failed: () => deps.report('broadcast.release_failed'),
    });
    // A lost lease, a stop seen at renewal or the slot stopping ends the step.
    const stepping = AbortSignal.any([lease.signal, stopSeen.signal, stop]);
    // A failure backs off even after a stop is seen: only a lost lease or the
    // slot stopping cuts it short, so an outage never becomes a tight retry.
    const backingOff = AbortSignal.any([lease.signal, stop]);
    /** Checked before each public write: a takedown must never be undone by a late one. */
    const ensureLease = () => {
      if (stepping.aborted || !lease.holds())
        throw new LeaseEnded(lease.holds() ? 'stopped' : 'expired');
    };
    try {
      while (!stop.aborted && lease.holds()) {
        facts = {
          ...lease.facts(),
          streamEndedAt: facts.streamEndedAt ?? lease.facts().streamEndedAt,
        };
        if (facts.completedAt !== null) break;
        // Set by the encode port while the step runs.
        const step: { encoded: boolean; attempting: number | null } = {
          encoded: false,
          attempting: null,
        };
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
                step.encoded = true;
                step.attempting = clip.capturedAtMs;
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
                const bound = deadlineSignal(
                  waits,
                  ENCODE_TIMEOUT_MS,
                  stepping,
                );
                const code = await Bun.spawn([...args], {
                  stderr: 'ignore',
                  signal: bound.signal,
                }).exited.finally(bound.clear);
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
          else if (
            result.kind === 'waiting' &&
            result.nextDueMs !== undefined &&
            result.nextDueMs - deps.now() > PARK_AFTER_MS
          ) {
            await store.park({
              id: job.id,
              owner: deps.owner,
              epoch: job.leaseEpoch,
              until: new Date(result.nextDueMs),
            });
            break;
          } else await waits.sleep(IDLE_MS, stepping);
        } catch (error) {
          if (!(error instanceof LeaseEnded)) {
            deps.report('broadcast.release_failed');
            const clipMs = step.attempting;
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
              } else
                await waits.sleep(
                  CLIP_RETRY_MS * 2 ** (attempts - 1),
                  backingOff,
                );
            } else await waits.sleep(IDLE_MS, backingOff);
          }
        } finally {
          if (step.encoded)
            await scratch
              .clear(job.id)
              .catch(() => deps.report('broadcast.release_failed'));
        }
      }
    } finally {
      // Broadcast never clears an unfenced lease: the next owner waits it out.
      await lease.stop();
    }
  };
  return pollWork({
    waits,
    backoff: { busyMs: IDLE_MS, idleMaxMs: IDLE_MAX_MS },
    // A database blip must not end this slot: the pass fails, is reported, and backs off.
    pass: async (stop) => {
      const claimedAtMs = waits.nowMs();
      const job = await store.claim({
        owner: deps.owner,
        now: new Date(deps.now()),
        leaseUntil: new Date(deps.now() + LEASE_MS),
      });
      if (!job) return 'idle';
      await holdJob(job, claimedAtMs, stop);
      return 'worked';
    },
    failed: () => deps.report('broadcast.release_failed'),
  });
};
