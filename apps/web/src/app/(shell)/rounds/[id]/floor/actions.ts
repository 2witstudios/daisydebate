'use server';
import { headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import { processRoute } from '../../../../../server/process-app';
import { roundFloorComposition } from '../../../../../features/messaging/round-floor/composition';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { submitContextChatMessage } from '../../../../../features/messaging/context-chat/form';
import type { ContextChatFormState } from '../../../../../features/messaging/context-chat/form-state';
import { submitContextChatChange } from '../../../../../features/messaging/context-chat/change-form';
import { roundFloorContext } from '../../../../../features/messaging/round-floor/floor-context';
const send = (roundId: string) =>
  processRoute(
    roundFloorComposition,
    (routes) => (request) => routes.send(request, roundId),
  );
const edit = (roundId: string) =>
  processRoute(
    roundFloorComposition,
    (routes) => (request) => routes.edit(request, roundId),
  );
const remove = (roundId: string) =>
  processRoute(
    roundFloorComposition,
    (routes) => (request) => routes.remove(request, roundId),
  );
const report = (roundId: string) =>
  processRoute(
    roundFloorComposition,
    (routes) => (request) => routes.report(request, roundId),
  );
export async function sendFloorMessageAction(
  roundId: string,
  channelId: string,
  previous: ContextChatFormState,
  form: FormData,
): Promise<ContextChatFormState> {
  return submitContextChatMessage(
    roundFloorContext,
    inProcessFetch(send(roundId), new Headers(await headers())),
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
      inProcessFetch((kind === 'edit' ? edit : remove)(roundId), incoming)(
        url,
        init,
      ),
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
    (_kind, url, init) => inProcessFetch(report(roundId), incoming)(url, init),
    { ownerId: roundId, channelId },
    previous,
    form,
    () => systemId.next(),
    true,
  );
}

const discover = (roundId: string) =>
  processRoute(
    roundFloorComposition,
    (routes) => (request) => routes.discover(request, roundId),
  );
export async function discoverFloor(roundId: string): Promise<Response> {
  return inProcessFetch(discover(roundId), new Headers(await headers()))(
    roundFloorContext.address(roundId),
    { method: 'GET' },
  );
}
