'use server';

import { headers } from 'next/headers';
import { submitRoomCreation } from '../../../features/rooms/create-room-form';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import type { FormState } from '../../../features/forms/form-state';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const create = processRoute((routes) => routes.rooms.create);
const catalog = processRoute((routes) => routes.rooms.catalog);

export async function roomTemplates() {
  return readRoomTemplates(
    inProcessFetch(catalog, new Headers(await headers())),
  );
}

/** Durable create uses the same authenticated/same-origin handler as the API. */
export async function createRoomAction(
  _state: FormState,
  form: unknown,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  return submitRoomCreation(inProcessFetch(create, incoming), incoming, form);
}
