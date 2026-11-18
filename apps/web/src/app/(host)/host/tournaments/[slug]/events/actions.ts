'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  eventFormContextSchema,
  eventFormEnvelope,
  eventFormAnswer,
  eventFormRefused,
  eventFormUnacknowledged,
  type EventFormContext,
  type EventFormState,
} from '../../../../../../features/tab/event-form';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../../server/form-action';
import { POST } from '../../../../../api/tab/lobby-command/route';
export async function eventAction(
  value: EventFormContext,
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const parsed = eventFormContextSchema.safeParse(value);
  if (!parsed.success)
    return eventFormRefused(
      form,
      'Reload this tournament before changing its schedule.',
    );
  const context = parsed.data;
  let envelope;
  try {
    envelope = eventFormEnvelope(context, form);
  } catch {
    return eventFormRefused(
      form,
      'Complete the event and schedule fields with their displayed choices.',
    );
  }
  const incoming = new Headers(await headers());
  let answer;
  try {
    const response = await inProcessFetch(POST, incoming)(
      '/api/tab/lobby-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? eventFormUnacknowledged(form)
        : eventFormRefused(
            form,
            'You cannot make this change. Reload the tournament.',
          );
    answer = eventFormAnswer(form, await response.json());
  } catch {
    return eventFormUnacknowledged(form);
  }
  if (answer.kind !== 'accepted') return answer;
  for (const path of [
    hostRoutes.events(context.handle),
    hostRoutes.setup(context.handle),
    hostRoutes.tournament(context.handle),
  ])
    revalidatePath(path);
  const selected =
    context.target.kind === 'create' ||
    (context.target.kind === 'command' &&
      context.target.command.type === 'remove-event')
      ? null
      : context.returnEventId;
  return moveOn(incoming, hostRoutes.events(context.handle, selected));
}
