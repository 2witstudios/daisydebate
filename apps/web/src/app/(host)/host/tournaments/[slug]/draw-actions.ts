'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  drawFormContextSchema,
  drawFormEnvelope,
  drawFormAnswer,
  drawFormRefused,
  drawFormUnacknowledged,
  type DrawFormContext,
  type DrawFormState,
} from '../../../../../features/tab/draw-form';
import { hostRoutes } from '../../../../../features/tab/routes';
import { runTabCommandForm } from '../../../../../features/tab/command-form-action';
import { moveOn } from '../../../../../features/forms/form-action';
import { POST } from '../../../../api/tab/draw-command/route';
export async function drawAction(
  value: DrawFormContext,
  _previous: DrawFormState,
  form: FormData,
): Promise<DrawFormState> {
  const parsed = drawFormContextSchema.safeParse(value);
  if (!parsed.success)
    return drawFormRefused(form, 'Reload this draw before changing it.');
  const context = parsed.data;
  let envelope;
  try {
    envelope = drawFormEnvelope(context, form);
  } catch {
    return drawFormRefused(form, 'Complete each rule override reason.');
  }
  const incoming = new Headers(await headers());
  const answer = await runTabCommandForm({
    post: POST,
    incoming,
    path: `/api/tab/draw-command?${new URLSearchParams({ lobbyId: context.lobbyId })}`,
    body: envelope,
    answer: (response) => drawFormAnswer(form, response),
    refused: () =>
      drawFormRefused(form, 'You cannot change this draw. Reload the event.'),
    unacknowledged: () => drawFormUnacknowledged(form),
  });
  if (answer.kind !== 'accepted') return answer;
  const path = hostRoutes.round(
    context.handle,
    context.eventId,
    context.tabRoundId,
  );
  revalidatePath(path);
  revalidatePath(hostRoutes.tournament(context.handle));
  return moveOn(incoming, path);
}
