'use server';

import { headers } from 'next/headers';
import { readAssembly } from '../../../../features/rooms/read-assembly';
import { saveSettings } from '../../../../features/rooms/save-settings';
import { submitAssembly } from '../../../../features/rooms/submit-assembly';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { hydratedPost, moveOn } from '../../../../server/form-action';
import {
  commandAnswer,
  roomFormAnswer,
  type RoomFormState,
} from '../../../../features/rooms/command-answer';
import { processRoute } from '../../../../server/process-app';
import {
  submitInvitationForm,
  type InvitationFormState,
} from '../../../../features/room-invitations/submit';
import {
  contentWaiverAnswer,
  submitContentWaiver,
} from '../../../../features/agreements/submit-content-waiver';

const read = processRoute(
  (routes) => (request) =>
    routes.rooms.read(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const signWaiver = processRoute(
  (routes) => routes.agreements.contentWaiver.POST,
);
const commands = processRoute(
  (routes) => (request) =>
    routes.rooms.commands(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);

const invitations = {
  invite: processRoute(
    (routes) => (request) =>
      routes.roomInvitations.invite(
        request,
        new URL(request.url).pathname.split('/')[3] ?? '',
      ),
  ),
  withdraw: processRoute(
    (routes) => (request) => routes.roomInvitations.end(request, 'withdraw'),
  ),
  decline: processRoute(
    (routes) => (request) => routes.roomInvitations.end(request, 'decline'),
  ),
};

/**
 * Invites a member, or withdraws or declines an invitation (ADR 0124). A
 * native post comes back to the Room; a hydrated page keeps the answer and
 * its room sync picks up the change from the Room's doorbell.
 */
export async function roomInvitationAction(
  id: string,
  _state: InvitationFormState,
  form: FormData,
): Promise<InvitationFormState> {
  const incoming = new Headers(await headers());
  const intent = form.get('intent');
  const route =
    intent === 'withdraw'
      ? invitations.withdraw
      : intent === 'decline'
        ? invitations.decline
        : invitations.invite;
  const answer = await submitInvitationForm(
    (path, body) =>
      inProcessFetch(route, incoming)(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    id,
    form,
  );
  if (!hydratedPost(incoming)) moveOn(incoming, `/rooms/${id}`);
  return answer;
}

export async function roomAssembly(id: string) {
  return readAssembly(inProcessFetch(read, new Headers(await headers())), id);
}

async function submitRoomCommand(id: string, form: FormData) {
  const incoming = new Headers(await headers());
  const result = await submitAssembly(
    inProcessFetch(commands, incoming),
    id,
    form,
  );
  return { incoming, result };
}

export async function submitRoomFormAction(
  id: string,
  _state: RoomFormState,
  form: FormData,
): Promise<RoomFormState> {
  const { incoming, result } = await submitRoomCommand(id, form);
  return roomFormAnswer(result, form, {
    hydrated: hydratedPost(incoming),
    move: (destination) => moveOn(incoming, destination),
  });
}

/** Native posts return to a fresh projection; the hydrated room adopts the answer. */
export async function roomCommandAction(
  id: string,
  _state: RoomFormState,
  form: FormData,
): Promise<RoomFormState> {
  const { incoming, result } = await submitRoomCommand(id, form);
  return commandAnswer(result, id, form, {
    hydrated: hydratedPost(incoming),
    move: (destination) => moveOn(incoming, destination),
  });
}

/** Signs the season's waiver, then answers with the room it unblocks. */
export async function signContentWaiverAction(
  id: string,
  _state: RoomFormState,
  form: FormData,
): Promise<RoomFormState> {
  const incoming = new Headers(await headers());
  const result = await submitContentWaiver(
    inProcessFetch(signWaiver, incoming),
    form,
  );
  const hydrated = hydratedPost(incoming);
  const current =
    hydrated && result === 'signed' ? await roomAssembly(id) : null;
  return contentWaiverAnswer(result, id, form, {
    hydrated,
    view: current?.kind === 'found' ? current.view : null,
    move: (destination) => moveOn(incoming, destination),
  });
}

/** Form conversions use the fresh canonical source, preserving the submitted version fence. */
export async function saveRoomSettingsAction(
  id: string,
  state: RoomFormState,
  form: FormData,
): Promise<RoomFormState> {
  return saveSettings(
    {
      read: () => roomAssembly(id),
      submit: (command) => submitRoomFormAction(id, state, command),
    },
    form,
  );
}

/** Client consent recovery uses canonical commands without tearing down preview tracks. */
export async function roomConsentIntent(id: string, form: FormData) {
  if (form.get('type') !== 'ready' && form.get('type') !== 'unready')
    return { kind: 'invalid' as const };
  return submitAssembly(
    inProcessFetch(commands, new Headers(await headers())),
    id,
    form,
  );
}
