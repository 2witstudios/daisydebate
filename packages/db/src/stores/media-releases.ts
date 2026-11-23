import { createMediaReleaseClubs } from '../media-release-club';
import { mediaReleaseMailOperations } from '../media-release-mail';
import { createMediaReleases } from '../media-releases';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Media releases (ADR 0151): the minor, the parent, the club and their mail. */
export const createMediaReleaseStore = (
  resources: DatabaseResources,
  { nextId }: { readonly nextId: () => string },
) => {
  const { bounded, lane, eventSink } = resourcesOf(resources);
  const run = bounded('control');
  return namedLaneOperations({
    mediaReleases: createMediaReleases({ run, nextId }),
    mediaReleaseClubs: createMediaReleaseClubs({ run, nextId }),
    ...mediaReleaseMailOperations({
      database: lane('control').database,
      eventSink,
    }),
  });
};
export type MediaReleaseStore = ReturnType<typeof createMediaReleaseStore>;
export type { MinorReleaseRead, ParentLinkRead } from '../media-releases';
export type {
  ClubReleasesRead,
  ClubReleaseStudent,
} from '../media-release-club';
export type {
  MediaReleaseMailKind,
  PreparedReleaseMail,
} from '../media-release-mail';
