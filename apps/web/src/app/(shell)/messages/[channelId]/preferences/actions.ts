'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { messagingPreferenceSchemas } from '@daisy/protocol';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../server/form-action';
import {
  parsePreferenceForm,
  preferenceUnavailable,
  type PreferenceFormState,
} from '../../../../../features/messaging/forms/preference-form';
export async function changePreferenceAction(
  channelId: unknown,
  _previous: PreferenceFormState,
  form: FormData,
): Promise<PreferenceFormState> {
  const incoming = new Headers(await headers()),
    kept = preferenceUnavailable(form);
  let next: string;
  try {
    const { operation, command } = parsePreferenceForm(channelId, form);
    const handle = processRoute(
      (routes) => (request) => routes.messaging.preferences(request, operation),
    );
    const response = await inProcessFetch(handle, incoming)(
      operation === 'clear'
        ? '/api/messaging/preferences/clear'
        : '/api/messaging/preferences',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) return kept;
    const answer =
      operation === 'clear'
        ? messagingPreferenceSchemas.cleared.safeParse(await response.json())
        : messagingPreferenceSchemas.result.safeParse(await response.json());
    if (!answer.success || answer.data.channelId !== command.channelId)
      return kept;
    next = `/messages/${command.channelId}/preferences`;
    revalidatePath('/messages');
  } catch {
    return kept;
  }
  return { ...kept, notice: '', ...moveOn(incoming, next) };
}
