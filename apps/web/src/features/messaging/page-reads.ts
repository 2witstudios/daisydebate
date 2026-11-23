import { messageOfferFor } from './request-offer';
import { channelMessagesWindow } from '@daisy/protocol/messaging/channel-messages';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/**
 * Whether this app offers private-group creation, invitation and
 * admission: never in beta (ISSUE-643), only under an isolated test
 * composition. Pages omit those controls when it does not.
 */
export const privateGroupsOffered = (): boolean =>
  requestApp().messagingPolicy.privateGroups === 'enabled';

/** The latest page a conversation reads: the live window, within this policy's page. */
export const messagingLatestPageItems = (): number =>
  Math.min(
    channelMessagesWindow.limit,
    requestApp().messagingPolicy.bounds.pageItems,
  );

/** What this member's profile view offers toward `username` (decision 90). */
export const requestMessageOffer = async (username: string) => {
  const identity = await requestIdentity();
  return identity.state === 'member'
    ? messageOfferFor(requestApp(), identity.principal, username)
    : ('none' as const);
};
