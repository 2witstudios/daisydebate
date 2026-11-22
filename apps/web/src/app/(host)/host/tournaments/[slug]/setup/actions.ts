'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  setupPairingEnvelope,
  setupPairingAnswer,
  setupPairingRefused,
  setupPairingUnacknowledged,
  type SetupPairingContext,
  type SetupPairingState,
} from '../../../../../../features/tab/setup-pairing-form';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
import { moveOn } from '../../../../../../server/form-action';
import { POST } from '../../../../../api/tab/settings-command/route';

export async function setupPairingAction(
  context: SetupPairingContext,
  _previous: SetupPairingState,
  form: FormData,
): Promise<SetupPairingState> {
  let envelope;
  try {
    envelope = setupPairingEnvelope(context, form);
  } catch {
    return setupPairingRefused(form, 'Choose a pairing preset.');
  }
  const incoming = new Headers(await headers());
  const state = await runTabCommandForm({
    post: POST,
    incoming,
    path: '/api/tab/settings-command',
    body: envelope,
    answer: (response) => setupPairingAnswer(form, response),
    refused: () =>
      setupPairingRefused(
        form,
        'You cannot change this setup. Reload this page.',
      ),
    unacknowledged: () => setupPairingUnacknowledged(form),
  });
  if (state.kind !== 'accepted') return state;
  const path = `${hostRoutes.setup(context.handle)}?event=${context.eventId}`;
  revalidatePath(hostRoutes.setup(context.handle));
  return moveOn(incoming, path);
}
