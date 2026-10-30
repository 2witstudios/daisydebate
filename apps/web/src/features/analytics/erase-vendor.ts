import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';

const accepted = z.object({
  events_queued_for_deletion: z.literal(true),
  recordings_queued_for_deletion: z.literal(true),
  deletion_errors: z.array(z.unknown()).max(0),
});

/** Acknowledges only the vendor's durable acceptance of event and recording deletion. */
export const createPostHogErasure = (input: {
  readonly host: string;
  readonly projectId: string;
  readonly key: string;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
}) => ({
  async erase(subjectRef: string): Promise<void> {
    if (
      !idSchema.safeParse(subjectRef).success ||
      !/^\d+$/.test(input.projectId) ||
      !['https://us.posthog.com', 'https://eu.posthog.com'].includes(input.host)
    )
      throw createAppError('VALIDATION');
    const response = await input.fetch(
      `${input.host}/api/projects/${input.projectId}/persons/bulk_delete/`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          authorization: `Bearer ${input.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          distinct_ids: [subjectRef],
          delete_events: true,
          delete_recordings: true,
          keep_person: false,
        }),
      },
    );
    if (!response.ok || !accepted.safeParse(await response.json()).success)
      throw createAppError('INFRASTRUCTURE');
  },
});
