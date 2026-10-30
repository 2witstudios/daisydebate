import type { Fetch } from '../../src/features/mail/resend-sender';

/** The configured analytics proof never sends even synthetic management credentials outside the machine. */
export const withAnalyticsFixture =
  (downstream: Fetch): Fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!url.hostname.endsWith('.posthog.com')) return downstream(input, init);
    if (
      url.href !==
        'https://us.posthog.com/api/projects/1/persons/bulk_delete/' ||
      request.headers.get('authorization') !== 'Bearer phx_browser_fixture'
    )
      return new Response(null, { status: 403 });
    return Response.json(
      {
        events_queued_for_deletion: true,
        recordings_queued_for_deletion: true,
        deletion_errors: [],
      },
      { status: 202 },
    );
  };
