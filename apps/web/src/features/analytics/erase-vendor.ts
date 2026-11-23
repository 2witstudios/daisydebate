import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import { deadlineSignal, type Waits } from '@daisy/clock';
import { createAppError } from '@daisy/errors';

const queued = z.object({
  events_queued_for_deletion: z.literal(true),
  recordings_queued_for_deletion: z.literal(true),
  deletion_errors: z.array(z.unknown()).max(0),
});
const absent = z.object({
  persons_found: z.literal(0),
  events_queued_for_deletion: z.literal(false),
  recordings_queued_for_deletion: z.literal(false),
  deletion_errors: z.array(z.unknown()).max(0),
});
const accepted = z.union([queued, absent]);
/** How long one erasure request, its answer included, may take. */
const ERASE_DEADLINE_MS = 5000;

/** Accept durable deletion acknowledgement or an explicit authenticated empty match. */
export const createPostHogErasure = (input: {
  readonly host: string;
  readonly projectId: string;
  readonly key: string;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** The time the request's deadline is measured on (R4.7). */
  readonly waits: Waits;
}) => ({
  async erase(subjectRef: string): Promise<void> {
    if (
      !idSchema.safeParse(subjectRef).success ||
      !/^\d+$/.test(input.projectId) ||
      !['https://us.posthog.com', 'https://eu.posthog.com'].includes(input.host)
    )
      throw createAppError('VALIDATION');
    const deadline = deadlineSignal(input.waits, ERASE_DEADLINE_MS);
    try {
      const response = await input.fetch(
        `${input.host}/api/projects/${input.projectId}/persons/bulk_delete/`,
        {
          method: 'POST',
          redirect: 'error',
          signal: deadline.signal,
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
      if (
        response.status !== 202 ||
        !accepted.safeParse(await response.json().catch(() => null)).success
      )
        throw createAppError('INFRASTRUCTURE');
    } finally {
      deadline.clear();
    }
  },
});
