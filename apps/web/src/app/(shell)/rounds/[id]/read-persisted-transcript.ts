import { headers } from 'next/headers';
import {
  readTranscript,
  TRANSCRIPT_READ_DEADLINE_MS,
} from '../../../../features/round-runtime/read-transcript';
import { renderReadDeadline } from '../../../../lib/page-reads';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { GET } from '../../../api/rounds/[roundId]/transcript/route';

/** A server render's seed, on a fresh audience decision. The browser reads the route itself. */
export async function readPersistedTranscript(id: string) {
  const deadline = renderReadDeadline(TRANSCRIPT_READ_DEADLINE_MS);
  try {
    return await readTranscript(
      inProcessFetch(
        (request) => GET(request, { params: Promise.resolve({ roundId: id }) }),
        new Headers(await headers()),
      ),
      id,
      deadline.signal,
    );
  } finally {
    deadline.clear();
  }
}
