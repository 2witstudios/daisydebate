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
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
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
  const answer = await runTabCommandForm({
    post: POST,
    incoming,
    path: '/api/tab/lobby-command',
    body: envelope,
    answer: (response) => eventFormAnswer(form, response),
    refused: () =>
      eventFormRefused(
        form,
        'You cannot make this change. Reload the tournament.',
      ),
    unacknowledged: () => eventFormUnacknowledged(form),
  });
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
  return moveOn(
    incoming,
    context.returnTo === 'resolutions' && selected
      ? hostRoutes.resolutions(context.handle, selected)
      : hostRoutes.events(context.handle, selected),
  );
}
