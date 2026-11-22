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
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
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
  const answer = await runTabCommandForm({
    post: POST,
    incoming,
    path: '/api/tab/lobby-command',
    body: envelope,
    answer: (response) => standingRoomAnswer(form, response),
    refused: () =>
      refused(
        form,
        'This room cannot be created. Check your access, eligibility and league settings before retrying.',
      ),
    unacknowledged: () => standingRoomUnavailable(form),
  });
  if (answer.kind !== 'accepted') return answer;
  revalidatePath('/leagues');
  return moveOn(incoming, `/rooms/${answer.roomId}`);
}
