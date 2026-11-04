import { audienceStateKey } from '@daisy/db/audience-state-key';
import { audienceStatePath } from '@daisy/protocol';

/**
 * Where an admitted reader polls a Round's published state. Handed out only past
 * admission, so an unlisted Round's address stays with its link. Null with no public
 * origin configured or no Broadcast.
 */
export const publishedStateUrl = (
  origin: string | undefined,
  feedKey: string | null,
  linkHash: string | null,
): string | null =>
  origin && feedKey
    ? new URL(audienceStatePath(audienceStateKey(feedKey, linkHash)), origin)
        .href
    : null;
