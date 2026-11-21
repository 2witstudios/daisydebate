'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { entryCommandEnvelopeSchema } from '@daisy/protocol/lobby/entry-command';
import {
  done,
  singleFormField,
  type Done,
} from '../../../../../features/forms/form-state';
import {
  eventFormAnswer,
  eventFormRefused,
  eventFormUnacknowledged,
  type EventFormState,
} from '../../../../../features/tab/event-form';
import { tabRoutes } from '../../../../../features/tab/routes';
import { stayOn } from '../../../../../server/form-action';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { POST } from '../../../../api/tab/entries-command/route';

import {
  entryFormContextSchema,
  type EntryFormContext,
} from '../../../../../features/tab/participant-entries';

export async function enterTournament(
  value: EntryFormContext,
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState | Done> {
  const parsed = entryFormContextSchema.safeParse(value);
  if (!parsed.success)
    return eventFormRefused(form, 'Reload the tournament before entering.');
  const { commandId, expected, eventId, actorId, lobbyId, handle } =
    parsed.data;
  let envelope;
  try {
    envelope = entryCommandEnvelopeSchema.parse({
      version: 1,
      commandId,
      expected: { entries: expected },
      command: {
        type: 'submit-entry',
        eventId,
        name: singleFormField(form, 'name'),
        memberActorIds: [actorId],
        responsible: { kind: 'self' },
        division: singleFormField(form, 'division') || null,
      },
    });
  } catch {
    return eventFormRefused(form, 'Enter a name and choose a division.');
  }
  const incoming = new Headers(await headers());
  try {
    const response = await inProcessFetch(POST, incoming)(
      `/api/tab/entries-command?${new URLSearchParams({ lobbyId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? eventFormUnacknowledged(form)
        : eventFormRefused(form, 'This entry is unavailable.');
    const state = eventFormAnswer(form, await response.json());
    if (state.kind !== 'accepted') return state;
  } catch {
    return eventFormUnacknowledged(form);
  }
  const path = tabRoutes.entries(handle);
  revalidatePath(path);
  return stayOn(incoming, path) ?? done();
}
