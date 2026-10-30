'use server';

import { moveOn } from '../../../server/form-action';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { systemId } from '@daisy/clock';
import {
  challengeCommandResultSchema,
  friendCommandResultSchema,
} from '@daisy/protocol';
import {
  challengeDeclinedNotice,
  friendDoneNotice,
  friendFormUnavailable,
  friendRefusalNotice,
  friendRouteFor,
  parseFriendForm,
  type FriendFormState,
  type FriendIntent,
} from '../../../features/friends/forms';
import { challengeFriend } from '../../../features/friends/challenge';
import { submitRoomCreation } from '../../../features/rooms/create-room-form';
import { requestIdentity } from '../../../lib/request-session';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const routes = {
  request: processRoute((all) => all.friends.request),
  respond: processRoute((all) => all.friends.respond),
  remove: processRoute((all) => all.friends.remove),
  challenge: processRoute((all) => all.friends.challenge),
  declineChallenge: processRoute((all) => all.friends.declineChallenge),
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
    const { intent, username, roomId } = parseFriendForm(form);
    const { route, path, body } = friendRouteFor(intent, username, roomId);
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
    const reply: unknown = await response.json();
    const notice =
      intent === 'decline-challenge'
        ? challengeDoneNotice(challengeCommandResultSchema.safeParse(reply))
        : friendDoneNoticeOf(
            intent,
            friendCommandResultSchema.safeParse(reply),
          );
    if (notice === null) return kept;
    revalidatePath('/friends');
    revalidatePath('/profile/[username]', 'page');
    return { username: '', notice };
  } catch {
    return kept;
  }
}

/**
 * Challenge an accepted friend: an unlisted room named for the two members,
 * the challenge delivered to the friend's /friends, then the room itself
 * (ADR 0072).
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
      challenges: inProcessFetch(routes.challenge, incoming),
    },
    create: (room, beforeMoveOn) =>
      submitRoomCreation(
        inProcessFetch(createRoom, incoming),
        incoming,
        room,
        '/api/rooms',
        beforeMoveOn,
        moveOn,
      ),
  });
}

/** The notice for a declined challenge, or null when its reply is not one. */
function challengeDoneNotice(
  result: ReturnType<typeof challengeCommandResultSchema.safeParse>,
): string | null {
  return result.success && result.data.challenge === 'declined'
    ? challengeDeclinedNotice(result.data.username)
    : null;
}

/** The notice for a friendship change, or null when its reply is not one. */
function friendDoneNoticeOf(
  intent: Exclude<FriendIntent, 'decline-challenge'>,
  result: ReturnType<typeof friendCommandResultSchema.safeParse>,
): string | null {
  return result.success
    ? friendDoneNotice(intent, result.data.username, result.data.relation)
    : null;
}
