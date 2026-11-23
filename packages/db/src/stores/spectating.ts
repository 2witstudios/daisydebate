import { audienceSnapshotReads } from '../audience-snapshot-reads';
import {
  liveBroadcastReads,
  watchableRoundOfRoomRead,
} from '../live-broadcast-reads';
import { roundAudienceLinkOperations } from '../round-audience-link';
import { spectatorFactLogOperations } from '../spectator-fact-log';
import { spectatorTimelineReads } from '../spectator-timeline-reads';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * What an audience reads (the timeline, live broadcasts, snapshots, the
 * audience link) on the audience lane, so a full one refuses viewers alone;
 * the host's link commands and the watchable Round on the competitive lane;
 * the fact log on the control lane.
 */
export const createSpectatingStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const audience = lane('audience').database;
  const competitive = lane('competitive').database;
  return namedLaneOperations({
    ...spectatorTimelineReads({ database: audience, eventSink }),
    ...liveBroadcastReads({ database: audience }),
    ...watchableRoundOfRoomRead({ database: competitive }),
    ...audienceSnapshotReads({ database: audience, eventSink }),
    ...roundAudienceLinkOperations({ viewers: audience, host: competitive }),
    ...spectatorFactLogOperations({ database: lane('control').database }),
  });
};
export type SpectatingStore = ReturnType<typeof createSpectatingStore>;
export type { SpectatorTimelineRead } from '../spectator-timeline-reads';
export type { LiveBroadcastPage } from '../live-broadcast-reads';
