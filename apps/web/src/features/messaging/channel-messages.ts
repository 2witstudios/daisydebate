import {
  createMessagingCoreSchemas,
  messagingBetaLimits,
} from '@daisy/protocol';
import type { ObservationDescriptor } from '../realtime/observation-provider';
import type { MessagingConversation } from './conversation';

const { historyResult } = createMessagingCoreSchemas({
  messageUnits: messagingBetaLimits.messageUnits,
  pageItems: messagingBetaLimits.pageItems,
});

/**
 * The live latest page of one conversation (ADR 0089): the same history
 * shape the authorized HTTP read returns, validated at the socket boundary,
 * ordered by the stream's content revision.
 */
export const channelMessages = (
  channelId: string,
): ObservationDescriptor<MessagingConversation> => ({
  resource: { kind: 'channel-messages', id: channelId },
  parse: (body) => {
    // jitless: the strict CSP refuses Zod's eval-compiled parser.
    const parsed = historyResult.safeParse(body, { jitless: true });
    return parsed.success && parsed.data.channelId === channelId
      ? parsed.data
      : null;
  },
  revisionOf: (body) => body.changeVersion,
});
