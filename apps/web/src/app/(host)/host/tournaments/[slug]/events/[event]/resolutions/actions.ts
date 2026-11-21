'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  eventFormAnswer,
  eventFormRefused,
  eventFormUnacknowledged,
  type EventFormState,
} from '../../../../../../../../features/tab/event-form';
import {
  roundReleaseContext,
  roundReleaseEnvelope,
  type RoundReleaseContext,
} from '../../../../../../../../features/tab/host-resolutions';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import {
  done,
  type Done,
} from '../../../../../../../../features/forms/form-state';
import { stayOn } from '../../../../../../../../server/form-action';
import { inProcessFetch } from '../../../../../../../../server/in-process-fetch';
import { POST } from '../../../../../../../api/tab/release-command/route';

export async function releaseRoundContent(
  value: RoundReleaseContext,
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState | Done> {
  const input = roundReleaseContext.safeParse(value);
  if (!input.success)
    return eventFormRefused(form, 'Reload the round before releasing it.');
  const { lobbyId, handle, eventId } = input.data;
  const envelope = roundReleaseEnvelope(input.data);
  const incoming = new Headers(await headers());
  try {
    const response = await inProcessFetch(POST, incoming)(
      `/api/tab/release-command?${new URLSearchParams({ lobbyId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? eventFormUnacknowledged(form)
        : eventFormRefused(form, 'You cannot release this round content.');
    const answer = eventFormAnswer(form, await response.json());
    if (answer.kind !== 'accepted') return answer;
  } catch {
    return eventFormUnacknowledged(form);
  }
  const destination = hostRoutes.resolutions(handle, eventId);
  revalidatePath(destination);
  return stayOn(incoming, destination) ?? done();
}
