'use client';

import { useResource } from '../../edge/use-driver';
import { authClient } from '../../../lib/auth-client';

type SessionClient = Pick<typeof authClient, 'getSession'>;

/** One sliding refresh per auth client: asked once, nothing held open. */
const refreshSession = (client: SessionClient) => {
  void client.getSession();
  return { dispose: () => undefined };
};

/**
 * Keeps a durable session sliding. Server components read sessions without
 * refreshing (they cannot set cookies), so when the server sees a refresh
 * is due (features/auth/page-reads.ts) it renders this, and the browser asks the
 * real `/api/auth/get-session` handler, which extends the session row and
 * its cookie together. It shows nothing.
 */
export function SessionRefresh() {
  useResource(authClient, refreshSession);
  return null;
}
