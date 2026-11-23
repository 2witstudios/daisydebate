import { releaseAccountOf } from '../../../features/flags/release-account';
import {
  releaseKeys,
  type OpenReleases,
} from '../../../features/guides/library';
import {
  requestIdentity,
  requestReleaseEnabled,
} from '../../../lib/request-session';

/**
 * The releases open for this viewer, among those a guide waits on, so a
 * guide shows exactly where its feature does.
 */
export const requestGuideReleases = async (): Promise<OpenReleases> => {
  const account = releaseAccountOf(await requestIdentity());
  const open = await Promise.all(
    releaseKeys.map(
      async (key) => [key, await requestReleaseEnabled(key, account)] as const,
    ),
  );
  return new Set(open.flatMap(([key, enabled]) => (enabled ? [key] : [])));
};
