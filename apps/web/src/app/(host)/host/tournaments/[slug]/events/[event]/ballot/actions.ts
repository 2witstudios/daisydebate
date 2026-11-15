'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  publishBallotEnvelope,
  pinBallotEnvelope,
  screeningBallotEnvelope,
  ballotAuthoringAnswer,
  ballotAuthoringRefused,
  ballotAuthoringUnacknowledged,
  type BallotAuthoringContext,
  type BallotAuthoringMode,
  type BallotAuthoringState,
} from '../../../../../../../../features/tab/ballot-authoring-form';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { inProcessFetch } from '../../../../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../../../../server/form-action';
import { POST as setupPOST } from '../../../../../../../api/tab/lobby-command/route';
import { POST as settingsPOST } from '../../../../../../../api/tab/settings-command/route';

export async function ballotAuthoringAction(
  context: BallotAuthoringContext,
  mode: BallotAuthoringMode,
  _previous: BallotAuthoringState,
  form: FormData,
): Promise<BallotAuthoringState> {
  let envelope;
  try {
    envelope =
      mode === 'publish'
        ? publishBallotEnvelope(context, form)
        : mode === 'pin'
          ? pinBallotEnvelope(context, form)
          : screeningBallotEnvelope(context, form);
  } catch {
    return ballotAuthoringRefused(
      form,
      'Complete the ballot fields. Defaults must lie on the score scale, and every criterion needs its own key and guidance.',
    );
  }
  const incoming = new Headers(await headers());
  let state;
  try {
    const path =
      mode === 'screening'
        ? '/api/tab/settings-command'
        : '/api/tab/lobby-command';
    const response = await inProcessFetch(
      mode === 'screening' ? settingsPOST : setupPOST,
      incoming,
    )(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!response.ok)
      return response.status >= 500
        ? ballotAuthoringUnacknowledged(form)
        : ballotAuthoringRefused(
            form,
            'You cannot change this event. Reload this page.',
          );
    state = ballotAuthoringAnswer(form, await response.json());
  } catch {
    return ballotAuthoringUnacknowledged(form);
  }
  if (state.kind !== 'accepted') return state;
  const path = hostRoutes.ballot(context.handle, context.eventId);
  revalidatePath(path);
  revalidatePath(hostRoutes.setup(context.handle));
  return moveOn(incoming, `${path}?saved=${mode}`);
}
