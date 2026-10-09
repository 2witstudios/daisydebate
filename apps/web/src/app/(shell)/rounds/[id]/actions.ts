'use server';

import { headers } from 'next/headers';
import { readRoundReceipt } from '../../../../features/rooms/read-round';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';

const roundRead = processRoute(
  (routes) => (request) =>
    routes.rounds.read(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);

/** The same canonical Round read, carrying this request's auth and ingress headers. */
export async function readPersistedRound(id: string) {
  return readRoundReceipt(
    inProcessFetch(roundRead, new Headers(await headers())),
    id,
  );
}
