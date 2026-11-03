'use server';

import { headers } from 'next/headers';
import {
  submitIssue,
  type AudienceLinkAnswer,
} from '../../../../../features/audience-link/submit-issue';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processApp, processRoute } from '../../../../../server/process-app';

const issue = processRoute(
  (routes) => (request) =>
    routes.audienceLink.issue(
      request,
      decodeURIComponent(new URL(request.url).pathname.split('/')[3] ?? ''),
    ),
);

/**
 * A native post from the host's page. The bound id is untrusted, and the route's
 * own gates decide. The link comes back as action state, never in a URL.
 */
export async function issueAudienceLinkAction(
  roundId: string,
): Promise<AudienceLinkAnswer> {
  return submitIssue(inProcessFetch(issue, new Headers(await headers())), {
    roundId,
    origin: processApp().config.PUBLIC_APP_URL,
  });
}
