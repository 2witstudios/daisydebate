'use server';
import { POST as releasePOST } from '../../../../api/tab/release-command/route';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  completionContextSchema,
  completionEnvelope,
  completionAnswer,
  completionRefused,
  completionUnacknowledged,
  type CompletionContext,
  type CompletionFormState,
} from '../../../../../features/tab/completion-form';
import { hostRoutes } from '../../../../../features/tab/routes';
import { runTabCommandForm } from '../../../../../features/tab/command-form-action';
import { moveOn, stayOn } from '../../../../../server/form-action';
import { done, type Done } from '../../../../../features/forms/form-state';
import { POST } from '../../../../api/tab/result-command/route';

export async function eventCompletionAction(
  value: CompletionContext,
  _previous: CompletionFormState,
  form: FormData,
): Promise<CompletionFormState | Done> {
  const parsed = completionContextSchema.safeParse(value);
  if (!parsed.success)
    return completionRefused(form, 'Reload this event before trying again.');
  const context = parsed.data;
  let envelope;
  try {
    envelope = completionEnvelope(context, form);
  } catch {
    return completionRefused(
      form,
      'Choose which written copy to publish and complete its fields.',
    );
  }
  const incoming = new Headers(await headers());
  const opening = context.target.type === 'open-audience';
  const state = await runTabCommandForm({
    post: opening ? releasePOST : POST,
    incoming,
    path: `/api/tab/${opening ? 'release-command' : 'result-command'}?${new URLSearchParams({ lobbyId: context.lobbyId })}`,
    body: envelope,
    answer: (response) => completionAnswer(form, response),
    refused: () =>
      completionRefused(form, 'You cannot make this change. Reload the event.'),
    unacknowledged: () => completionUnacknowledged(form),
  });
  if (state.kind !== 'accepted') return state;
  for (const path of [
    hostRoutes.ballots(context.handle),
    hostRoutes.results(context.handle),
    hostRoutes.standings(context.handle),
  ])
    revalidatePath(path);
  const path =
    context.target.type === 'resolve-screening-hold'
      ? hostRoutes.ballots(context.handle)
      : context.target.type === 'announce-break'
        ? hostRoutes.standings(context.handle)
        : hostRoutes.results(context.handle);
  const query = new URLSearchParams({
    event: context.eventId,
    ...(context.target.type === 'resolve-screening-hold'
      ? { round: context.target.roundId }
      : {}),
  });
  const target = `${path}?${query}`;
  return context.target.type === 'open-audience' &&
    context.target.thing === 'posting'
    ? (stayOn(incoming, target) ?? done())
    : moveOn(incoming, target);
}
