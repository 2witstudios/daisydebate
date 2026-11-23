import type { Identity } from '@daisy/auth';
import { isReleaseEnabled } from '../flags/server';

/**
 * Whether bot debates are released to this viewer (`bot-debates`), for a
 * page's display. Signed out or unreadable, they are not. The Room create
 * route and the Round freeze refuse on their own; this only shapes the page.
 */
export const botDebatesReleasedTo = (identity: Identity): Promise<boolean> =>
  identity.state === 'member'
    ? isReleaseEnabled('bot-debates', identity.principal.userId).catch(
        () => false,
      )
    : Promise.resolve(false);
