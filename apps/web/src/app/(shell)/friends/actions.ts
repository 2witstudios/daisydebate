'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { systemId } from '@daisy/clock';
import { friendCommandResultSchema } from '@daisy/protocol';
import {
  friendDoneNotice,
  friendFormUnavailable,
  friendRefusalNotice,
  friendRouteFor,
  parseFriendForm,
  type FriendFormState,
} from '../../../features/messaging/friends/forms';
import { challengeFriend } from '../../../features/messaging/friends/challenge';
import { submitRoomCreation } from '../../../features/rooms/create-room-form';
import { requestIdentity } from '../../../lib/request-session';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const routes = {
  request: processRoute((all) => all.friends.request),
  respond: processRoute((all) => all.friends.respond),
  remove: processRoute((all) => all.friends.remove),
};
const friendList = processRoute((all) => all.friends.list);
const createRoom = processRoute((all) => all.rooms.create);
const roomCatalog = processRoute((all) => all.rooms.catalog);

/**
 * Every friend form: the same route a script would call, in process with
 * this request's own headers, so each gate still runs. A change re-renders
 * /friends; a refusal keeps what was typed.
 */
export async function friendAction(
  _previous: FriendFormState,
  form: FormData,
): Promise<FriendFormState> {
  const kept = friendFormUnavailable(form);
  try {
    const { intent, username } = parseFriendForm(form);
    const { route, path, body } = friendRouteFor(intent, username);
    const response = await inProcessFetch(
      routes[route],
      new Headers(await headers()),
    )(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      return {
        username: kept.username,
        notice: friendRefusalNotice(intent, response.status),
      };
    const result = friendCommandResultSchema.safeParse(await response.json());
    if (!result.success) return kept;
    revalidatePath('/friends');
    return {
      username: '',
      notice: friendDoneNotice(
        intent,
        result.data.username,
        result.data.relation,
      ),
    };
  } catch {
    return kept;
  }
}

/**
 * Challenge an accepted friend: an unlisted room named for the two members,
 * then the room itself, whose invite link the challenger sends (ADR 0072).
 */
export async function challengeAction(
  _previous: FriendFormState,
  form: FormData,
): Promise<FriendFormState> {
  const identity = await requestIdentity();
  if (identity.state !== 'member')
    return { username: '', notice: 'Sign in to challenge a friend.' };
  const incoming = new Headers(await headers());
  return challengeFriend({
    viewer: identity.username,
    form,
    commandId: systemId.next(),
    routes: {
      friends: inProcessFetch(friendList, incoming),
      catalog: inProcessFetch(roomCatalog, incoming),
    },
    create: (room) =>
      submitRoomCreation(inProcessFetch(createRoom, incoming), incoming, room),
  });
}
