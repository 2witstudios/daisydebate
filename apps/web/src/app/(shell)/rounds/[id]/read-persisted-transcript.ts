import { headers } from 'next/headers';
import { readTranscript } from '../../../../features/round-runtime/read-transcript';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';

const transcriptRead = processRoute(
  (routes) => (request) =>
    routes.rounds.transcript(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
/** A server render's seed, on a fresh audience decision. The browser reads the route itself. */
export async function readPersistedTranscript(id: string) {
  return readTranscript(
    inProcessFetch(transcriptRead, new Headers(await headers())),
    id,
  );
}
