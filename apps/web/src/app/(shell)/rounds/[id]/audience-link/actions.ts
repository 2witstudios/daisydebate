'use server';

import { headers } from 'next/headers';
import {
  submitIssue,
  type AudienceLinkAnswer,
} from '../../../../../features/audience-link/submit-issue';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
import { audienceLinkComposition } from '../../../../../features/audience-link/composition';

const issue = (roundId: string) =>
  processRoute(
    audienceLinkComposition,
    (routes) => (request) => routes.issue(request, roundId),
  );

/**
 * A native post from the host's page. The bound id is untrusted, and the route's
 * own gates decide. The link comes back as action state, never in a URL.
 */
export async function issueAudienceLinkAction(
  roundId: string,
): Promise<AudienceLinkAnswer> {
  return submitIssue(
    inProcessFetch(issue(roundId), new Headers(await headers())),
    roundId,
  );
}
