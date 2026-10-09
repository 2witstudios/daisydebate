'use server';

import { headers } from 'next/headers';
import { createAssembly } from '../../../features/rooms/create-assembly';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { refused, type MockFormState } from '../../../features/mock-form/form';
import { moveOn } from '../../../server/form-action';
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
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  const submitted = form instanceof FormData ? form : new FormData();
  const incoming = new Headers(await headers());
  const result = await createAssembly(
    inProcessFetch(create, incoming),
    submitted,
  );
  if (result.kind === 'created')
    return { values: {}, ...moveOn(incoming, `/rooms/${result.roomId}`) };
  return refused(
    submitted,
    result.kind === 'invalid'
      ? 'Check the room name, topic and format template.'
      : result.kind === 'refused'
        ? 'The room could not be created. Review your settings and try again.'
        : 'Room creation is unavailable. Try again.',
  );
}
