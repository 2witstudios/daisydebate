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

const create = processRoute((routes) => routes.rooms.create);
const catalog = processRoute((routes) => routes.rooms.catalog);

/** The standards a practice may run, in the catalog's own order (DEC-269). */
const practiceFormatIds = ['freestyle', 'policy', 'value'];

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
  const formats = templates.choices.filter(
    (choice) =>
      choice.role === 'standard' && practiceFormatIds.includes(choice.formatId),
  );
  const request = preparePractice(
    form,
    {
      bots: templates.bots,
      botDebateAiJudge: templates.botDebateAiJudge,
      formats,
      resolutions: templates.resolutions,
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
  return answer.next ? { ...answer, ...moveOn(incoming, answer.next) } : answer;
}
