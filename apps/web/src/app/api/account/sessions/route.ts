import { createListSessionsHandler } from '../../../../features/account/sessions';
import { getAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createListSessionsHandler({
  origin: () => getAuth().config.PUBLIC_APP_URL,
  listSessions: async (headers) => getAuth().instance.api.listSessions({ headers }),
  currentSessionId: async (headers) => {
    const found = await getAuth().instance.api.getSession({
      headers,
      query: { disableRefresh: true },
    });
    return found?.session.id ?? null;
  },
});
