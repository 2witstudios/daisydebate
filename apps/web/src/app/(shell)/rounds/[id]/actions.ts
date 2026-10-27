'use server';

import { headers } from 'next/headers';
import { readTranscript } from '../../../../features/round-runtime/read-transcript';
import { readRoundReceipt } from '../../../../features/rooms/read-round';
import { readRoundAnalysis } from '../../../../features/round-analysis/reads';
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

const transcriptRead = processRoute(
  (routes) => (request) =>
    routes.rounds.transcript(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
/** A fresh transcript audience decision on every server action or native reload. */
export async function readPersistedTranscript(id: string) {
  return readTranscript(
    inProcessFetch(transcriptRead, new Headers(await headers())),
    id,
  );
}

const analysisRead = processRoute(
  (routes) => (request) =>
    routes.rounds.getRoundAnalysis(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
/** The caller's own round analysis, a read of its own, never part of the ballot read. */
export async function readPersistedRoundAnalysis(id: string) {
  return readRoundAnalysis(
    inProcessFetch(analysisRead, new Headers(await headers())),
    id,
  );
}
