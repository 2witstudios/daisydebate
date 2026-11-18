'use server';

import { revalidatePath } from 'next/cache';
import {
  done,
  field,
  formUnavailable,
  refused,
  type FormState,
} from '../../../features/forms/form-state';
import {
  askRefusalWords,
  resendRefusalWords,
} from '../../../features/media-releases/release-words';
import { POST as askRoute } from '../../api/media-releases/ask/route';
import { POST as resendRoute } from '../../api/media-releases/resend/route';
import { POST as cancelRoute } from '../../api/media-releases/cancel/route';
import { POST as askClubRoute } from '../../api/media-releases/ask-club/route';
import { post } from '../form-post';

const routes = {
  ask: askRoute,
  resend: resendRoute,
  cancel: cancelRoute,
  askClub: askClubRoute,
};

type Answer = {
  readonly kind?: string;
  readonly reason?: string;
};

/** Posts through the media release route, in process with this request's gates. */
async function send(
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<Answer | 'rate-limited' | 'unavailable'> {
  try {
    const response = await post(route, path, body);
    if (response.status === 429) return 'rate-limited';
    if (!response.ok) return 'unavailable';
    return ((await response.json().catch(() => null)) as Answer | null) ?? {};
  } catch {
    return 'unavailable';
  }
}

const settled = (
  form: FormData,
  answer: Awaited<ReturnType<typeof send>>,
  words: (reason: string) => string | undefined,
): FormState => {
  if (answer === 'rate-limited')
    return refused(form, 'Too many tries. Wait a little and try again.');
  if (answer === 'unavailable') return formUnavailable(form);
  if (answer.kind === 'refused')
    return refused(
      form,
      words(answer.reason ?? '') ?? 'That could not be done. Try again.',
    );
  revalidatePath('/settings');
  return done();
};

/** "Send request": the minor asks a parent's address to sign. */
export async function askReleaseAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const email = field(form, 'email').trim();
  if (email === '') return refused(form, askRefusalWords.invalid_email);
  return settled(
    form,
    await send(routes.ask, '/api/media-releases/ask', { email }),
    (reason) => askRefusalWords[reason as keyof typeof askRefusalWords],
  );
}

/** "Send again". */
export async function resendReleaseAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return settled(
    form,
    await send(routes.resend, '/api/media-releases/resend', {}),
    (reason) => resendRefusalWords[reason as keyof typeof resendRefusalWords],
  );
}

/** "Cancel request". */
export async function cancelReleaseAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return settled(
    form,
    await send(routes.cancel, '/api/media-releases/cancel', {}),
    () => undefined,
  );
}

/** "Ask my club": the club's owner and staff are told. */
export async function askClubAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = field(form, 'club');
  const answer = await send(routes.askClub, '/api/media-releases/ask-club', {
    organizationId,
  });
  if (typeof answer === 'object' && answer.kind === 'not_a_member')
    return refused(form, 'You are no longer a member of that club.');
  if (typeof answer === 'object' && answer.kind === 'already_asked')
    return refused(form, 'You asked this club in the last week.');
  return settled(form, answer, () => undefined);
}
