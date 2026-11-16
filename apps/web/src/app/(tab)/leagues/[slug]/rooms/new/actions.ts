'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  standingRoomEnvelope,
  standingRoomAnswer,
  standingRoomUnavailable,
  type StandingRoomContext,
  type StandingRoomState,
} from '../../../../../../features/tab/standing-room-form';
import { refused } from '../../../../../../features/forms/form-state';
import { moveOn } from '../../../../../../server/form-action';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { POST } from '../../../../../api/tab/lobby-command/route';
export async function standingRoomCreateAction(
  context: StandingRoomContext,
  _previous: StandingRoomState,
  form: FormData,
): Promise<StandingRoomState> {
  let envelope;
  try {
    envelope = standingRoomEnvelope(context, form);
  } catch {
    return refused(
      form,
      'Check the room name and resolution. Locked settings must match the displayed values.',
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
        ? standingRoomUnavailable(form)
        : refused(
            form,
            response.status === 409
              ? 'The league settings changed. Reload this form before creating the room.'
              : 'This room cannot be created. Reload to check your access and settings.',
          );
    answer = standingRoomAnswer(form, await response.json());
  } catch {
    return standingRoomUnavailable(form);
  }
  if (answer.kind !== 'accepted') return answer;
  revalidatePath('/leagues');
  return moveOn(incoming, `/rooms/${answer.roomId}`);
}
