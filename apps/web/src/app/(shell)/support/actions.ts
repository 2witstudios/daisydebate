'use server';

import { supportMessageResultSchema } from '@daisy/protocol/support-message';
import { formValues } from '../../../features/forms/form-state';
import {
  messageIncomplete,
  messageRateLimited,
  messageReceived,
  messageUnacknowledged,
  messageUnavailable,
  messageValuesOf,
  supportMessageOf,
  type MessageFormState,
} from '../../../features/support/message-form';
import { processRoute } from '../../../server/process-app';
import { post } from '../form-post';

const route = processRoute((routes) => routes.support.POST);

/**
 * The support form's POST, as a server action. The pure rule reads the form
 * first; an accepted message goes through the support route in process with
 * this request's headers, so its origin, session and rate-limit gates all
 * apply. A filled spam trap is answered like a sent message, and nothing is
 * posted.
 */
export async function sendSupportMessageAction(
  _previous: MessageFormState,
  form: FormData,
): Promise<MessageFormState> {
  const posted = formValues(form instanceof FormData ? form : new FormData());
  const values = messageValuesOf(posted);
  const reading = supportMessageOf(posted);
  switch (reading.kind) {
    case 'trapped':
      return messageReceived();
    case 'incomplete':
      return messageIncomplete(values, reading.errors);
    case 'accepted':
      break;
  }
  let response: Response;
  try {
    response = await post(route, '/api/support', reading.message);
  } catch {
    return messageUnacknowledged(values);
  }
  if (response.status === 429) return messageRateLimited(values);
  if (response.status >= 500) return messageUnacknowledged(values);
  if (!response.ok) return messageUnavailable(values);
  const answer = supportMessageResultSchema.safeParse(
    await response.json().catch(() => null),
  );
  return answer.success ? messageReceived() : messageUnacknowledged(values);
}
