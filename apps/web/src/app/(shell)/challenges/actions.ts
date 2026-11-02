'use server';

import { headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import { challengeListSchema, challengeResultSchema } from '@daisy/protocol';
import { acceptOffer } from '../../../features/challenges/accept-offer';
import {
  challengeFormUnavailable,
  challengeRefusal,
  type ChallengeFormState,
} from '../../../features/challenges/forms';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { submitRoomCreation } from '../../../features/rooms/create-room-form';
import { requestIdentity } from '../../../lib/request-session';
import { activeRoomRead } from '../actions';
import { post, text } from '../form-post';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const routes = {
  send: processRoute((all) => all.challenges.send),
  list: processRoute((all) => all.challenges.list),
  accept: processRoute((all) => all.challenges.accept),
  decline: processRoute((all) => all.challenges.decline),
  cancel: processRoute((all) => all.challenges.cancel),
  createRoom: processRoute((all) => all.rooms.create),
  catalog: processRoute((all) => all.rooms.catalog),
};

/** Offers a debate: nothing exists until the other member accepts. */
export async function sendChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  try {
    const response = await post(routes.send, '/api/challenges', {
      version: 1,
      commandId: systemId.next(),
      username: text(form, 'username'),
      mode: text(form, 'mode'),
      format: text(form, 'format'),
    });
    if (!response.ok)
      return { notice: challengeRefusal('send', response.status) };
    return challengeResultSchema.safeParse(await response.json()).success
      ? { sent: true, notice: 'Challenge sent.' }
      : challengeFormUnavailable();
  } catch {
    return challengeFormUnavailable();
  }
}

/** Accepts an offer; the sequence is `acceptOffer`, and this wires it to the routes. */
export async function acceptChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  const identity = await requestIdentity();
  if (identity.state !== 'member' || !identity.principal.actorId)
    return { notice: challengeRefusal('accept', 404) };
  const incoming = new Headers(await headers());
  const challengeId = text(form, 'challengeId');
  try {
    return await acceptOffer(
      {
        challengeId,
        username: identity.username,
        actorId: identity.principal.actorId,
      },
      {
        nextId: () => systemId.next(),
        readOffers: async () => {
          const listed = await inProcessFetch(routes.list, incoming)(
            '/api/challenges',
            { method: 'GET' },
          );
          const list = challengeListSchema
            .loose()
            .safeParse(listed.ok ? await listed.json() : null);
          return list.success ? list.data.incoming : null;
        },
        inARoom: async () => (await activeRoomRead()) !== null,
        readCatalog: () =>
          readRoomTemplates(inProcessFetch(routes.catalog, incoming)),
        openRoom: (room, beforeMoveOn) =>
          submitRoomCreation(
            inProcessFetch(routes.createRoom, incoming),
            incoming,
            room,
            '/api/rooms',
            beforeMoveOn,
            moveOn,
          ),
        nameRoom: (roomId) =>
          inProcessFetch(routes.accept, incoming)('/api/challenges/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ version: 1, challengeId, roomId }),
          }),
      },
    );
  } catch (error) {
    // moveOn's redirect for a native post is not a failure.
    if (isRedirect(error)) throw error;
    return challengeFormUnavailable();
  }
}

const isRedirect = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'digest' in error &&
  String((error as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');

/** Declines or withdraws an open offer. */
export async function endChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  const command = text(form, 'command') === 'cancel' ? 'cancel' : 'decline';
  try {
    const response = await post(routes[command], `/api/challenges/${command}`, {
      version: 1,
      challengeId: text(form, 'challengeId'),
    });
    return response.ok
      ? {}
      : { notice: challengeRefusal('end', response.status) };
  } catch {
    return challengeFormUnavailable();
  }
}
