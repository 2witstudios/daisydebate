'use client';

import { useEffect } from 'react';
import { authClient } from '../../../lib/auth-client';

/**
 * Keeps a durable session sliding. Server components read sessions without
 * refreshing (they cannot set cookies), so once per full page load a
 * signed-in browser asks the real `/api/auth/get-session` handler, which
 * extends the session row and its cookie together once `updateAge` passes.
 * Rendered only when a session cookie is present; it shows nothing.
 */
export function SessionRefresh() {
  useEffect(() => {
    void authClient.getSession();
  }, []);
  return null;
}
