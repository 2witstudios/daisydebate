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
 * What the worker publishes, for a suite with no worker: the same reads and the same
 * projections, written to the feed server's memory instead of a bucket. The publish
 * loop and its sampling are proven in apps/broadcast-worker and on staging.
 */
export const startAudienceStateStandIn = (input: {
  readonly url: string;
  readonly feedOrigin: string;
  readonly publish: (path: string, body: string) => void;
  readonly now: () => number;
}) => {
  const store = createAudiencePublisherStore(input.url);
  const pass = async () => {
    const nowMs = input.now();
    const publishing = await store.readPublishing({
      now: new Date(nowMs),
      keepMs: 3_600_000,
      settledKeepMs: 3_600_000,
      limit: 256,
    });
    await Promise.all(
      publishing.map(async (broadcast) => {
        const [timeline, audience] = await Promise.all([
          store.readSpectatorTimeline({
            roundId: broadcast.roundId,
            horizonOf: (facts) => spectatorTimelineHorizon({ ...facts, nowMs }),
          }),
          store.readAudienceSnapshot({ roundId: broadcast.roundId }),
        ]);
        if (!timeline || !audience) return;
        input.publish(
          audienceStatePath(
            audienceStateKey(broadcast.feedKey, broadcast.linkHash),
          ),
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
  };
  const timer = setInterval(() => void pass().catch(() => undefined), 500);
  return () => {
    clearInterval(timer);
    void store.close();
  };
};
