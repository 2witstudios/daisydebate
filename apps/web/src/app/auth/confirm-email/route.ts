import { createConfirmEmailHandlers } from '../../../features/auth/confirm-email';
import { getAuth } from '../../../lib/auth';
import { getResources } from '../../../server/resources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createConfirmEmailHandlers({
  auth: () => {
    const { instance, config } = getAuth();
    const { database } = getResources();
    return {
      handler: instance.handler,
      config,
      revokeOtherSessions: (userId: string, keepToken: string) =>
        database.revokeOtherSessions(userId, keepToken),
    };
  },
  appendSessionRevoked: (userId) =>
    getResources().database.appendSessionRevoked(userId),
});
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
