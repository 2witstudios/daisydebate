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
import { stayOn } from '../../../../../features/forms/form-action';
import { runTabCommandForm } from '../../../../../features/tab/command-form-action';
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
  const state = await runTabCommandForm({
    post: POST,
    incoming,
    path: `/api/tab/entries-command?${new URLSearchParams({ lobbyId })}`,
    body: envelope,
    answer: (response) => eventFormAnswer(form, response),
    refused: () => eventFormRefused(form, 'This entry is unavailable.'),
    unacknowledged: () => eventFormUnacknowledged(form),
  });
  if (state.kind !== 'accepted') return state;
  const path = tabRoutes.entries(handle);
  revalidatePath(path);
  return stayOn(incoming, path) ?? done();
}
