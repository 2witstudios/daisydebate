'use server';

import type { MatchHistoryQuery } from '@daisy/protocol';
import { headers } from 'next/headers';
import { fetchProfile } from '../../../../features/profile/fetch-profile';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';

const profileRead = processRoute(
  (routes) => (request) =>
    routes.profiles.read(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);

/** The same canonical profile read, carrying this request's auth and ingress headers. */
export async function readMemberProfile(
  username: string,
  query: MatchHistoryQuery,
) {
  return fetchProfile(
    inProcessFetch(profileRead, new Headers(await headers())),
    username,
    query,
  );
}
