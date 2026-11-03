'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { submitReport } from '../../../../features/moderation/submit-report';
import { readRoundReceipt } from '../../../../features/round-runtime/read-round';
import { readRoundAnalysis } from '../../../../features/round-analysis/reads';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';

const report = processRoute((routes) => routes.moderation.report.POST);

/**
 * A native post from this Round's page: the form names its target, and the
 * page comes back with a closed notice, so a reload never reports twice.
 */
export async function reportRoundAction(
  id: string,
  form: FormData,
): Promise<never> {
  const result = await submitReport(
    inProcessFetch(report, new Headers(await headers())),
    form,
  );
  redirect(`/rounds/${id}?report=${result}`);
}

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
