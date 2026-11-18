'use server';

import { leagueRequestResultSchema } from '@daisy/protocol/league-request';
import { formValues } from '../../../../features/forms/form-state';
import {
  leagueRequestOf,
  requestIncomplete,
  requestRateLimited,
  requestReceived,
  requestUnacknowledged,
  requestUnavailable,
  requestValuesOf,
  type RequestFormState,
} from '../../../../features/league-requests/request-form';
import { leagueRequestsReleased } from '../../../../features/league-requests/route-release';
import { processRoute } from '../../../../server/process-app';
import { post } from '../../form-post';

const route = processRoute((routes, app) =>
  routes.leagueRequests.POST(leagueRequestsReleased(app)),
);

/**
 * The League request form's POST, as a server action. The pure rule reads
 * the form first; an accepted request goes through the League request
 * route in process with this request's headers, so its release, origin and
 * rate-limit gates all apply. A filled spam trap is answered like a sent
 * request, and nothing is posted.
 */
export async function sendLeagueRequestAction(
  _previous: RequestFormState,
  form: FormData,
): Promise<RequestFormState> {
  const posted = formValues(form instanceof FormData ? form : new FormData());
  const values = requestValuesOf(posted);
  const reading = leagueRequestOf(posted);
  switch (reading.kind) {
    case 'trapped':
      return requestReceived();
    case 'incomplete':
      return requestIncomplete(values, reading.errors);
    case 'accepted':
      break;
  }
  let response: Response;
  try {
    response = await post(route, '/api/league-requests', reading.request);
  } catch {
    return requestUnacknowledged(values);
  }
  if (response.status === 429) return requestRateLimited(values);
  if (response.status >= 500) return requestUnacknowledged(values);
  if (!response.ok) return requestUnavailable(values);
  const answer = leagueRequestResultSchema.safeParse(
    await response.json().catch(() => null),
  );
  return answer.success ? requestReceived() : requestUnacknowledged(values);
}
