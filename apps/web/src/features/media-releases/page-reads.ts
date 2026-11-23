import { type ParentLinkRead } from '@daisy/db/stores/media-releases';
import { nowMs } from '@daisy/clock';
import {
  mediaReleaseSettingsView,
  type MediaReleaseSettingsView,
} from './settings-view';
import { type ReleaseLinkPurpose } from '@daisy/protocol/media-release';
import { isReleaseLinkToken, releaseLinkDigest } from './link-token';
import { requestApp } from '../../lib/page-reads';

/**
 * What a presented release link may do, read without changing anything; a
 * value that is not a token's shape is never looked up and reads as unknown.
 */
export const readReleaseLink = async (
  purpose: ReleaseLinkPurpose,
  token: string,
): Promise<ParentLinkRead> =>
  isReleaseLinkToken(token)
    ? requestApp().database.mediaReleases.readParentLink(
        releaseLinkDigest(purpose, token),
        purpose,
      )
    : { kind: 'unknown' };

/** The app's clock, for what a release page derives from a link's dates. */
export const releaseNowMs = (): number => nowMs(requestApp().clock);

/**
 * A youth member's media release section (ADR 0151), or null: only on Youth –
 * Freestyle.
 */
export const requestMediaReleaseSettings = async (
  userId: string,
): Promise<MediaReleaseSettingsView | null> => {
  const read =
    await requestApp().database.mediaReleases.readMinorRelease(userId);
  return read.division === 'youth' ? mediaReleaseSettingsView(read) : null;
};

export async function requestGuardianRelease(
  guardian: { readonly userId: string; readonly actorId: string },
  linkId: string,
) {
  return requestApp().database.mediaReleases.readGuardianRelease({
    guardian,
    linkId,
  });
}
