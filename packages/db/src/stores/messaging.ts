import type { ContactReactions } from '../contacts/reactions';
import { messagingOperations } from '../messaging/operations';
import { messageRequestSettingOperations } from '../messaging/request-settings';
import { retainedConversationOperations } from '../messaging/retained-store';
import { messagingUnreadEmailOperations } from '../messaging/unread-emails';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Messaging: conversations, retained conversations, request settings and unread email, on the social lane. */
export const createMessagingStore = (
  resources: DatabaseResources,
  { reactions }: { readonly reactions: ContactReactions },
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  return namedLaneOperations({
    ...messagingOperations(social, reactions),
    ...retainedConversationOperations({ database: social, eventSink }),
    ...messageRequestSettingOperations({ database: social, eventSink }),
    ...messagingUnreadEmailOperations({ database: social, eventSink }),
  });
};
export type MessagingStore = ReturnType<typeof createMessagingStore>;
export type { MessagingUnreadEmailDelivery } from '../messaging/unread-emails';
