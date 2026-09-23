import { createRevokeSessionHandler } from '../../../../../features/account/sessions';
import { getAuth } from '../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createRevokeSessionHandler({
  origin: () => getAuth().config.PUBLIC_APP_URL,
  listSessions: async (headers) =>
    getAuth().instance.api.listSessions({ headers }),
  revokeToken: async (headers, token) => {
    await getAuth().instance.api.revokeSession({ headers, body: { token } });
  },
});
