import type { MediaReleaseStore } from '@daisy/db/stores/media-releases';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const mediaReleaseRetentionTargets = (
  database: Pick<
    MediaReleaseStore,
    'purgeEndedMediaReleaseRequests' | 'purgeWithdrawnMediaReleases'
  >,
): readonly RetentionTarget[] => [
  /**
   * ADR 0151: a media release request (the parent's address) is kept 30
   * days after it ends or lapses, with its links and mail; a signed one
   * stays while a release it produced is active.
   */
  retentionAfter(
    'media_release_requests',
    30 * DAY_MS,
    (batch) => database.purgeEndedMediaReleaseRequests(batch),
    { maxBatches: 4 },
  ),
  /** ADR 0151: a withdrawn media release is kept 3 years as consent evidence. */
  retentionAfter(
    'media_releases',
    3 * 365 * DAY_MS,
    (batch) => database.purgeWithdrawnMediaReleases(batch),
    { maxBatches: 4 },
  ),
];
