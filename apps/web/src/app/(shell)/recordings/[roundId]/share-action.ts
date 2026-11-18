'use server';

import { redirect } from 'next/navigation';
import { processRoute } from '../../../../server/process-app';
import { post } from '../../form-post';

const route = processRoute(
  (routes) => (request) =>
    routes.mediaReleases.publish(
      new URL(request.url).pathname.split('/')[3] ?? '',
    )(request),
);

const roundIdPattern = /^[a-z0-9]{24}$/u;

/**
 * Share publicly (ADR 0151): a debater publishes a Youth Recording, through
 * the route's own gates. The page comes back with the answer.
 */
export async function shareYouthRecordingAction(
  roundId: string,
): Promise<void> {
  if (!roundIdPattern.test(roundId)) redirect('/recordings');
  let notice = 'unavailable';
  try {
    const response = await post(
      route,
      `/api/recordings/${roundId}/publish`,
      {},
    );
    if (response.ok) {
      const answer = (await response.json().catch(() => null)) as {
        readonly kind?: string;
        readonly reason?: string;
      } | null;
      notice =
        answer?.kind === 'published'
          ? 'shared'
          : (answer?.reason ?? 'unavailable');
    } else if (response.status === 429) notice = 'rate_limited';
  } catch {
    notice = 'unavailable';
  }
  redirect(`/recordings/${roundId}?share=${encodeURIComponent(notice)}`);
}
