import {
  projectAudienceSnapshot,
  projectSpectatorTimeline,
  spectatorTimelineHorizon,
} from '@daisy/debate-engine';
import {
  audienceStateKey,
  createAudiencePublisherStore,
} from '@daisy/db/audience-publisher';
import { audienceStatePath, officialFeedPath } from '@daisy/protocol';

/**
 * What the publisher writes, for a suite with no publisher: the same reads and the same
 * projections, written to the feed server's memory instead of a bucket. The publish
 * loop and its sampling are proven in apps/audience-publisher and on staging.
 */
export const startAudienceStateStandIn = (input: {
  readonly url: string;
  readonly feedOrigin: string;
  readonly publish: (path: string, body: string) => void;
  readonly withdraw: (path: string) => void;
  readonly now: () => number;
}) => {
  const store = createAudiencePublisherStore(input.url);
  const published = new Map<string, string>();
  const pass = async () => {
    const nowMs = input.now();
    const publishing = await store.readPublishing({
      now: new Date(nowMs),
      keepMs: 3_600_000,
      settledKeepMs: 3_600_000,
      limit: 256,
    });
    const active = new Set(publishing.map(({ broadcastId }) => broadcastId));
    for (const [broadcastId, path] of published) {
      if (active.has(broadcastId)) continue;
      input.withdraw(path);
      published.delete(broadcastId);
    }
    const results = await Promise.allSettled(
      publishing.map(async (broadcast) => {
        const timeline = await store.readSpectatorTimeline({
          roundId: broadcast.roundId,
          horizonOf: (facts) => spectatorTimelineHorizon({ ...facts, nowMs }),
        });
        const audience = await store.readAudienceSnapshot({
          roundId: broadcast.roundId,
        });
        if (!timeline || !audience) return;
        const path = audienceStatePath(
          audienceStateKey(broadcast.feedKey, broadcast.linkHash),
        );
        const was = published.get(broadcast.broadcastId);
        if (was && was !== path) input.withdraw(was);
        published.set(broadcast.broadcastId, path);
        input.publish(
          path,
          JSON.stringify({
            version: 1,
            publishedAtMs: nowMs,
            timeline: projectSpectatorTimeline(timeline, {
              nowMs,
              feedUrlOf: (key) =>
                new URL(officialFeedPath(key), input.feedOrigin).href,
            }),
            audience: projectAudienceSnapshot(
              broadcast.roundId,
              audience,
              null,
            ),
            pulseRate: 1,
          }),
        );
      }),
    );
    const failed = results.filter(({ status }) => status === 'rejected').length;
    if (failed)
      process.stderr.write(
        `${JSON.stringify({ event: 'e2e.audience_state.publish_failed', failed })}\n`,
      );
  };
  // A slow pass must drain its reads before another pass queues work on the pool.
  let publishing = false;
  const timer = setInterval(async () => {
    if (publishing) return;
    publishing = true;
    try {
      await pass();
    } catch {
      process.stderr.write(
        `${JSON.stringify({ event: 'e2e.audience_state.read_failed' })}\n`,
      );
    } finally {
      publishing = false;
    }
  }, 500);
  return () => {
    clearInterval(timer);
    void store.close();
  };
};
