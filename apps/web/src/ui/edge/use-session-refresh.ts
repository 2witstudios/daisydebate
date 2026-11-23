'use client';

import { useEffect } from 'react';
import { authClient } from '../../lib/auth-client';

/**
 * Asks the auth handler for the session once the page has hydrated, so a
 * durable session the server saw due for refresh slides forward (it extends
 * the session row and its cookie together). Server components cannot set
 * cookies, so the browser has to ask.
 */
export function useSessionRefresh(): void {
  useEffect(() => {
    void authClient.getSession();
  }, []);
}
