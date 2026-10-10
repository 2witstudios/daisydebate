'use server';
import { headers } from 'next/headers';
import { messagingDmDecisionResultSchema } from '@daisy/protocol';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../server/form-action';
import {
  parseDmDecisionForm,
  dmDecisionUnavailable,
  type DmDecisionFormState,
} from '../../../../../features/messaging/forms/decide-form';
const decide = processRoute((routes) => routes.messaging.decideDm);
export async function decideDmAction(
  channelId: unknown,
  _previous: DmDecisionFormState,
  form: FormData,
): Promise<DmDecisionFormState> {
  const incoming = new Headers(await headers());
  const kept = dmDecisionUnavailable(form);
  let next: string;
  try {
    const command = parseDmDecisionForm(channelId, form);
    const response = await inProcessFetch(decide, incoming)(
      '/api/messaging/requests/decide',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) return kept;
    const result = messagingDmDecisionResultSchema.safeParse(
      await response.json(),
    );
    if (!result.success || result.data.channelId !== command.channelId)
      return kept;
    next =
      result.data.state === 'accepted'
        ? `/messages/${command.channelId}`
        : '/lobby';
  } catch {
    return kept;
  }
  return { requestId: kept.requestId, ...moveOn(incoming, next) };
}
