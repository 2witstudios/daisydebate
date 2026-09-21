import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Reserved React client entrypoint (ADR 0017): same-origin /api/auth with the
 * passwordless plugin clients. No server configuration, secrets or feature
 * composition may enter this module's import graph.
 * The handler is mounted at /api/auth/[...all]; the client only talks to it
 * over HTTP and must never import it.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
});
