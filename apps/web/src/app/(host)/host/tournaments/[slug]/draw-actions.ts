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
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../server/form-action';
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
  let answer;
  try {
    const response = await inProcessFetch(POST, incoming)(
      `/api/tab/draw-command?${new URLSearchParams({ lobbyId: context.lobbyId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? drawFormUnacknowledged(form)
        : drawFormRefused(
            form,
            'You cannot change this draw. Reload the event.',
          );
    answer = drawFormAnswer(form, await response.json());
  } catch {
    return drawFormUnacknowledged(form);
  }
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
