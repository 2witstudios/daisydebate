import { headers } from 'next/headers';
import { readTranscript } from '../../../../features/round-runtime/read-transcript';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { GET } from '../../../api/rounds/[roundId]/transcript/route';

/** A server render's seed, on a fresh audience decision. The browser reads the route itself. */
export async function readPersistedTranscript(id: string) {
  return readTranscript(inProcessFetch(GET, new Headers(await headers())), id);
}
