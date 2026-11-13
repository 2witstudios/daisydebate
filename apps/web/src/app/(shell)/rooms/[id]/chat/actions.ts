'use server';
import { headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { submitContextChatMessage } from '../../../../../features/messaging/context-chat/form';
import type { ContextChatFormState } from '../../../../../features/messaging/context-chat/form-state';
import { submitContextChatChange } from '../../../../../features/messaging/context-chat/change-form';
import { roomChatContext } from '../../../../../features/messaging/room-community/room-chat-context';

const roomOf = (request: Request) =>
  new URL(request.url).pathname.split('/')[3] ?? '';
const send = processRoute(
  (routes) => (request) => routes.roomCommunity.send(request, roomOf(request)),
);
const edit = processRoute(
  (routes) => (request) => routes.roomCommunity.edit(request, roomOf(request)),
);
const remove = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.remove(request, roomOf(request)),
);
const report = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.report(request, roomOf(request)),
);
const discover = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.discover(request, roomOf(request)),
);

/** Each Room chat form posts through the canonical route: origin, session, limits and authority. */
export async function sendRoomChatMessageAction(
  roomId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  return submitContextChatMessage(
    roomChatContext,
    inProcessFetch(send, new Headers(await headers())),
    { ownerId: roomId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function mutateRoomChatMessageAction(
  roomId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  const incoming = new Headers(await headers());
  return submitContextChatChange(
    roomChatContext,
    (kind, url, init) =>
      inProcessFetch(kind === 'edit' ? edit : remove, incoming)(url, init),
    { ownerId: roomId, channelId },
    previous,
    form,
    () => systemId.next(),
  );
}
export async function reportRoomChatMessageAction(
  roomId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  const incoming = new Headers(await headers());
  return submitContextChatChange(
    roomChatContext,
    (_kind, url, init) => inProcessFetch(report, incoming)(url, init),
    { ownerId: roomId, channelId },
    previous,
    form,
    () => systemId.next(),
    true,
  );
}
/** A read: it never opens the chat. */
export async function discoverRoomChat(roomId: string): Promise<Response> {
  return inProcessFetch(discover, new Headers(await headers()))(
    roomChatContext.address(roomId),
    { method: 'GET' },
  );
}
