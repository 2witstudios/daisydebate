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
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
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
  let state;
  try {
    const response = await inProcessFetch(POST, incoming)(
      '/api/tab/settings-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? setupPairingUnacknowledged(form)
        : setupPairingRefused(
            form,
            'You cannot change this setup. Reload this page.',
          );
    state = setupPairingAnswer(form, await response.json());
  } catch {
    return setupPairingUnacknowledged(form);
  }
  if (state.kind !== 'accepted') return state;
  const path = `${hostRoutes.setup(context.handle)}?event=${context.eventId}`;
  revalidatePath(hostRoutes.setup(context.handle));
  return moveOn(incoming, path);
}
