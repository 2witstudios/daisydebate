'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { submitReport } from '../../../../features/content-moderation/submit-report';
import { readRoundReceipt } from '../../../../features/round-runtime/read-round';
import { readRoundAnalysis } from '../../../../features/round-analysis/reads';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';
import { contentModerationComposition } from '../../../../features/content-moderation/composition';
import { roundAnalysisComposition } from '../../../../features/round-analysis/composition';
import { roundComposition } from '../../../../features/round-runtime/composition';

const report = processRoute(
  contentModerationComposition,
  (routes) => routes.report.POST,
);

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

const roundRead = (id: string) =>
  processRoute(
    roundComposition,
    (routes) => (request) => routes.read(request, id),
  );

/** The same canonical Round read, carrying this request's auth and ingress headers. */
export async function readPersistedRound(id: string) {
  return readRoundReceipt(
    inProcessFetch(roundRead(id), new Headers(await headers())),
    id,
  );
}

const analysisRead = (id: string) =>
  processRoute(
    roundAnalysisComposition,
    (routes) => (request) => routes.getRoundAnalysis(request, id),
  );
/** The caller's own round analysis, a read of its own, never part of the ballot read. */
export async function readPersistedRoundAnalysis(id: string) {
  return readRoundAnalysis(
    inProcessFetch(analysisRead(id), new Headers(await headers())),
    id,
  );
}
