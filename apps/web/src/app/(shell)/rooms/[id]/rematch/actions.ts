'use server';
import { headers } from 'next/headers';
import type { MockFormState } from '../../../../../features/mock-form/form';
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
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  const incoming = new Headers(await headers());
  return submitRoomCreation(
    inProcessFetch(rematch, incoming),
    incoming,
    form,
    `/api/rooms/${encodeURIComponent(sourceRoomId)}/rematch`,
  );
}
