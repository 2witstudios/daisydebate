import type { MessagingStore } from '@daisy/db/stores/messaging';
import { messageRequestSettingSchema } from '@daisy/protocol/messaging/social';
import {
  accountRoute,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';

/**
 * POST /api/messaging/request-setting: who may send the member new message
 * requests (decision 90, ADR 0160). The member's own choice, for their own
 * account only; it never closes a conversation already accepted.
 */
export const createMessageRequestSettingRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<MessagingStore, 'writeMessageRequestSetting'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'messaging.request_setting',
      limit: { max: 120, windowSeconds: 3600 },
      maxBodyBytes: 256,
      refusals: [],
    },
    async ({ identity, body }) => {
      const { setting } = parseValidated(messageRequestSettingSchema, body);
      await deps.store.writeMessageRequestSetting({
        userId: identity.principal.userId,
        setting,
      });
      return Response.json({ received: true });
    },
  );
