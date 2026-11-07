'use server';
import { headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import {
  submitFloorMessage,
  type FloorFormState,
} from '../../../../../features/messaging/round-floor/form';
import { submitFloorChange } from '../../../../../features/messaging/round-floor/change-form';
const send = processRoute(
  (routes) => (request) =>
    routes.roundFloor.send(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const edit = processRoute(
  (routes) => (request) =>
    routes.roundFloor.edit(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const remove = processRoute(
  (routes) => (request) =>
    routes.roundFloor.remove(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const report = processRoute(
  (routes) => (request) =>
    routes.roundFloor.report(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export async function sendFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: FloorFormState,
  form: FormData,
): Promise<FloorFormState> {
  return submitFloorMessage(
    inProcessFetch(send, new Headers(await headers())),
    { roundId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function mutateFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: FloorFormState,
  form: FormData,
): Promise<FloorFormState> {
  const incoming = new Headers(await headers());
  return submitFloorChange(
    (kind, url, init) =>
      inProcessFetch(kind === 'edit' ? edit : remove, incoming)(url, init),
    { roundId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function reportFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: FloorFormState,
  form: FormData,
): Promise<FloorFormState> {
  const incoming = new Headers(await headers());
  return submitFloorChange(
    (_kind, url, init) => inProcessFetch(report, incoming)(url, init),
    { roundId, channelId },
    previous,
    form,
    () => systemId.next(),
    true,
  );
}

const discover = processRoute(
  (routes) => (request) =>
    routes.roundFloor.discover(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export async function discoverFloor(roundId: string): Promise<Response> {
  return inProcessFetch(discover, new Headers(await headers()))(
    `/api/rounds/${roundId}/floor`,
    { method: 'GET' },
  );
}
