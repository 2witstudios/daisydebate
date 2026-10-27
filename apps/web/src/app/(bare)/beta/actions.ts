'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearedCookieNames } from '../../../features/auth/cleared-cookies';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const authRoute = processRoute((routes) => routes.auth.POST);

/**
 * Sign-out from the beta page, as a server action, so a waitlisted account
 * can leave without JavaScript (ISSUE-691). It runs the mounted
 * POST /api/auth/sign-out in process with this request's headers, so the
 * route's own gates apply and the server revokes the session, then clears
 * in the browser exactly the cookies that response cleared.
 */
export async function signOutAction(): Promise<void> {
  const response = await inProcessFetch(
    authRoute,
    new Headers(await headers()),
  )('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const jar = await cookies();
  for (const name of clearedCookieNames(response.headers.getSetCookie()))
    jar.delete({
      name,
      path: '/',
      ...(name.startsWith('__Secure-') ? { secure: true } : {}),
    });
  redirect('/sign-in');
}
