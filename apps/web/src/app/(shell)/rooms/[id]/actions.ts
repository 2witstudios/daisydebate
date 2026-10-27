'use server';

import { headers } from 'next/headers';
import { readAssembly } from '../../../../features/rooms/read-assembly';
import { prepareSettings } from '../../../../features/rooms/prepare-settings';
import { submitAssembly } from '../../../../features/rooms/submit-assembly';
import {
  refused,
  type MockFormState,
} from '../../../../features/mock-form/form';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { hydratedPost, moveOn } from '../../../../server/form-action';
import {
  commandAnswer,
  roomFormAnswer,
  type RoomFormState,
} from '../../../../features/rooms/command-answer';
import { processRoute } from '../../../../server/process-app';

const read = processRoute(
  (routes) => (request) =>
    routes.rooms.read(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const commands = processRoute(
  (routes) => (request) =>
    routes.rooms.commands(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);

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
  _state: MockFormState,
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
  _state: MockFormState,
  form: FormData,
): Promise<RoomFormState> {
  const { incoming, result } = await submitRoomCommand(id, form);
  return commandAnswer(result, id, form, {
    hydrated: hydratedPost(incoming),
    move: (destination) => moveOn(incoming, destination),
  });
}

/** Form conversions use the fresh canonical source, preserving the submitted version fence. */
export async function saveRoomSettingsAction(
  id: string,
  state: MockFormState,
  form: FormData,
): Promise<RoomFormState> {
  const current = await roomAssembly(id);
  if (current.kind !== 'found')
    return refused(form, 'Settings are unavailable. Try again.');
  const prepared = prepareSettings(current.view, form);
  if (prepared.kind !== 'prepared')
    return refused(
      form,
      prepared.kind === 'conflict'
        ? 'The room changed. Review the latest room before saving.'
        : 'These settings are not permitted. Check the values and try again.',
    );
  const command = new FormData();
  for (const [name, value] of Object.entries(prepared.command))
    command.set(
      name,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    );
  const result = await submitRoomFormAction(id, state, command);
  return result.error ? refused(form, result.error) : result;
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
