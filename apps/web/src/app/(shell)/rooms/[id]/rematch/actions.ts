'use server';
import { headers } from 'next/headers';
import type { FormState } from '../../../../../features/forms/form-state';
import { submitRoomCreation } from '../../../../../features/rooms/create-room-form';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
const rematch = processRoute(
  (routes) => (request) =>
    routes.rooms.rematch(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export async function createFreshRoomAction(
  sourceRoomId: string,
  _state: FormState,
  form: unknown,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  return submitRoomCreation(
    inProcessFetch(rematch, incoming),
    incoming,
    form,
    `/api/rooms/${encodeURIComponent(sourceRoomId)}/rematch`,
  );
}
