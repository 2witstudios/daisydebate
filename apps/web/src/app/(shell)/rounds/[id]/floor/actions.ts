'use server';
import { headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { submitContextChatMessage } from '../../../../../features/messaging/context-chat/form';
import type { ContextChatFormState } from '../../../../../features/messaging/context-chat/form-state';
import { submitContextChatChange } from '../../../../../features/messaging/context-chat/change-form';
import { roundFloorContext } from '../../../../../features/messaging/round-floor/floor-context';
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
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  return submitContextChatMessage(
    roundFloorContext,
    inProcessFetch(send, new Headers(await headers())),
    { ownerId: roundId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function mutateFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  const incoming = new Headers(await headers());
  return submitContextChatChange(
    roundFloorContext,
    (kind, url, init) =>
      inProcessFetch(kind === 'edit' ? edit : remove, incoming)(url, init),
    { ownerId: roundId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function reportFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  const incoming = new Headers(await headers());
  return submitContextChatChange(
    roundFloorContext,
    (_kind, url, init) => inProcessFetch(report, incoming)(url, init),
    { ownerId: roundId, channelId },
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
    roundFloorContext.address(roundId),
    { method: 'GET' },
  );
}
