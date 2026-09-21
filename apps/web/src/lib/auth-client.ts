import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Reserved React client entrypoint (ADR 0017): same-origin /api/auth with the
 * passwordless plugin clients. No server configuration, secrets or feature
 * composition may enter this module's import graph.
 * The /api/auth route handler does not exist yet; it arrives with auth
 * activation (ADR 0020), so do not wire this client into UI before then.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
});
