'use server';

import { systemId } from '@daisy/clock';
import { headers } from 'next/headers';
import { refused, type FormState } from '../../../features/forms/form-state';
import {
  practiceAnswer,
  preparePractice,
} from '../../../features/train/start-practice';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { roomComposition } from '../../../features/room-runtime/composition';

const create = processRoute(roomComposition, (routes) => routes.create);
const catalog = processRoute(roomComposition, (routes) => routes.catalog);

/**
 * Start practice: the form's one act. It reads the one catalog (the same
 * roster the Room's seat controls use), asks for the practice create, and
 * moves on to the ordinary Room; every refusal comes back as form state.
 */
export async function startPracticeAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  const templates = await readRoomTemplates(inProcessFetch(catalog, incoming));
  if (templates.kind !== 'found')
    return refused(form, 'Practice is unavailable. Try again.');
  const request = preparePractice(
    form,
    {
      bots: templates.bots,
      botDebateAiJudge: templates.botDebateAiJudge,
      choices: templates.choices,
    },
    systemId.next(),
  );
  if (request.kind === 'refused') return refused(form, request.error);
  const response = await inProcessFetch(create, incoming)('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  const answer = await practiceAnswer(response, form);
  // Native server-action posts need an actual 303; hydrated forms navigate
  // from the returned `next` state through useMovedOn.
  return answer.kind === 'moved' ? moveOn(incoming, answer.next) : answer;
}
