import {
  projectAudienceSnapshot,
  projectSpectatorTimeline,
  spectatorTimelineHorizon,
} from '@daisy/debate-engine';
import type {
  audienceStateKey,
  createAudiencePublisherStore,
  PublishingBroadcast,
} from '@daisy/db/audience-publisher';
import {
  audienceStatePath,
  audienceStateSchema,
  latestViewerBucket,
  pulseRateFor,
  viewerBucketOf,
  viewersFromSample,
} from '@daisy/protocol';

/** How long a Broadcast's state stays once it is over and its Recording has settled. */
const STATE_SETTLED_KEEP_MS = 10 * 60_000;
/** How long it stays for a Recording that has not settled. */
const STATE_KEEP_MS = 6 * 60 * 60_000;
const STATE_PUBLISH_EVERY_MS = 1000;
const STATE_BROADCASTS = 256;
const STATE_HEADERS = {
  'cache-control': 'no-cache',
  'content-type': 'application/json',
} as const;

type Store = Pick<
  ReturnType<typeof createAudiencePublisherStore>,
  | 'readPublishing'
  | 'readSpectatorTimeline'
  | 'readAudienceSnapshot'
  | 'recordStateWithdrawn'
>;

/**
 * Why a pass did not publish everything. `read` lost the whole pass, `publish` lost
 * `failed` Broadcasts in it. Closed values, so no error text reaches a log.
 */
export type AudienceStateFailure = {
  readonly cause: 'read' | 'publish';
  readonly failed: number;
};

type Deps = {
  readonly store: Store;
  readonly objects: {
    readonly putState: (
      key: string,
      body: string,
      headers: Readonly<Record<string, string>>,
    ) => Promise<void>;
    readonly deletePublic: (key: string) => Promise<void>;
    /** The object's text, or null with none. */
    readonly readState: (key: string) => Promise<string | null>;
  };
  readonly counts: {
    readonly readViewerCount: (
      roundId: string,
      bucket: number,
    ) => Promise<number>;
  };
  readonly keyOf: typeof audienceStateKey;
  readonly feedUrlOf: (feedKey: string) => string | null;
  readonly now: () => number;
  readonly report: (failure: AudienceStateFailure) => void;
};

/**
 * Publishes each Broadcast's released public state to the public bucket, so a
 * viewer's read never reaches web (DEC-350). What it holds in memory, each Broadcast's
 * key and sampling, comes back within a count's gathering after a restart.
 */
export const createAudienceStatePublisher = (deps: Deps) => {
  /**
   * Each Broadcast's key, and the sampling of the bucket now gathering and the one
   * before it. A count is scaled by the rate tabs held while it gathered, never the
   * newest, and the rate moves once a bucket, so the two cannot chase each other.
   */
  const held = new Map<
    string,
    {
      readonly key: string;
      readonly bucket: number;
      readonly rate: number;
      readonly previousRate: number;
    }
  >();

  const countOf = async (roundId: string, rate: number, nowMs: number) => {
    try {
      return viewersFromSample(
        await deps.counts.readViewerCount(roundId, latestViewerBucket(nowMs)),
        rate,
      );
    } catch {
      return null;
    }
  };

  /** After a restart: tabs still hold the rate in the object, so counts gather at it. */
  const restored = async (key: string) => {
    const body = await deps.objects.readState(key);
    const parsed = audienceStateSchema.safeParse(
      body === null ? null : JSON.parse(body),
    );
    return parsed.success
      ? {
          key,
          bucket: viewerBucketOf(parsed.data.publishedAtMs),
          rate: parsed.data.pulseRate,
          previousRate: parsed.data.pulseRate,
        }
      : undefined;
  };

  const publish = async (broadcast: PublishingBroadcast) => {
    const key = audienceStatePath(
      deps.keyOf(broadcast.feedKey, broadcast.linkHash),
    );
    if (broadcast.over) {
      await deps.objects.deletePublic(key);
      await deps.store.recordStateWithdrawn({
        broadcastId: broadcast.broadcastId,
        at: new Date(deps.now()),
      });
      held.delete(broadcast.broadcastId);
      return;
    }
    const was = held.get(broadcast.broadcastId) ?? (await restored(key));
    if (was && was.key !== key) await deps.objects.deletePublic(was.key);
    const nowMs = deps.now();
    const [timeline, audience] = await Promise.all([
      deps.store.readSpectatorTimeline({
        roundId: broadcast.roundId,
        horizonOf: (facts) => spectatorTimelineHorizon({ ...facts, nowMs }),
      }),
      deps.store.readAudienceSnapshot({ roundId: broadcast.roundId }),
    ]);
    if (!timeline || !audience) return;
    const bucket = viewerBucketOf(nowMs);
    const moved = was !== undefined && was.bucket !== bucket;
    const inForce = was?.rate ?? 1;
    const gatheredAt = moved ? inForce : (was?.previousRate ?? 1);
    const viewers = audience.open
      ? await countOf(broadcast.roundId, gatheredAt, nowMs)
      : null;
    // A lost count says nothing about the crowd, and a count that fell may only mean
    // pulses were lost, so the rate rises slowly: it is what brings tabs back to web.
    const rate =
      viewers !== null && (was === undefined || moved)
        ? Math.min(pulseRateFor(viewers), (was?.rate ?? 0.5) * 2)
        : (was?.rate ?? 1);
    const body = JSON.stringify(
      audienceStateSchema.parse({
        version: 1,
        publishedAtMs: nowMs,
        timeline: projectSpectatorTimeline(timeline, {
          nowMs,
          feedUrlOf: deps.feedUrlOf,
        }),
        audience: projectAudienceSnapshot(broadcast.roundId, audience, viewers),
        pulseRate: rate,
      }),
    );
    await deps.objects.putState(key, body, STATE_HEADERS);
    held.set(broadcast.broadcastId, {
      key,
      bucket,
      rate,
      previousRate: gatheredAt,
    });
  };

  return {
    /** One pass over every Broadcast; one failing never holds the rest. */
    pass: async () => {
      const publishing = await deps.store.readPublishing({
        now: new Date(deps.now()),
        keepMs: STATE_KEEP_MS,
        settledKeepMs: STATE_SETTLED_KEEP_MS,
        limit: STATE_BROADCASTS,
      });
      const results = await Promise.allSettled(publishing.map(publish));
      const failed = results.filter(
        (result) => result.status === 'rejected',
      ).length;
      if (failed > 0) deps.report({ cause: 'publish', failed });
    },
  };
};

/** Runs passes on the second until told to stop; a failed pass waits for the next. */
export const runAudienceStatePublisher = async (input: {
  readonly publisher: ReturnType<typeof createAudienceStatePublisher>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly report: (failure: AudienceStateFailure) => void;
}) => {
  while (!input.stopped()) {
    const startedAt = input.now();
    await input.publisher
      .pass()
      .catch(() => input.report({ cause: 'read', failed: 1 }));
    await input.sleep(
      Math.max(0, STATE_PUBLISH_EVERY_MS - (input.now() - startedAt)),
    );
  }
};
