import { friendListSchema, parseUsername } from '@daisy/protocol';
import type { MockFormState } from '../../mock-form/form';
import { casualSelection, defaultChoice } from '../../rooms/format-browser';
import { readRoomTemplates, type RoomTemplate } from '../../rooms/read-catalog';

/** The topic a challenge room opens with; the host edits it on the room page. */
const CHALLENGE_TOPIC = 'Open topic: agree on a resolution in the room';

/**
 * The room a Challenge creates (ADR 0072): unlisted, so only its invite
 * link reaches it, on the catalog's default format and its pinned preset,
 * named for the two members.
 */
function challengeRoomForm({
  viewer,
  friend,
  template,
  commandId,
}: {
  readonly viewer: string;
  readonly friend: string;
  readonly template: RoomTemplate;
  readonly commandId: string;
}): FormData {
  const form = new FormData();
  form.set('commandId', commandId);
  form.set('title', `@${viewer} vs @${friend}`);
  form.set('topic', CHALLENGE_TOPIC);
  form.set('visibility', 'unlisted');
  form.set('selection', JSON.stringify(casualSelection(template)));
  return form;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type ChallengeAnswer = {
  readonly username: string;
  readonly notice?: string;
  readonly next?: string;
};
const challengeUnavailable: ChallengeAnswer = {
  username: '',
  notice: 'Could not open a challenge room. Try again.',
};

/** Whether `username` is one of the caller's accepted friends now. */
async function isFriend(friends: FetchLike, username: string) {
  try {
    const response = await friends('/api/friends', { method: 'GET' });
    const list = friendListSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return (
      list.success &&
      list.data.friends.some((friend) => friend.username === username)
    );
  } catch {
    return false;
  }
}

/**
 * Delivers the challenge to the friend (ADR 0072): their /friends page then
 * offers the room. Best effort: the room exists either way, and its invite
 * link still reaches them. A refused delivery is not silent to operators:
 * the challenges route logs its status like every route.
 */
async function deliverChallenge(
  challenges: FetchLike,
  username: string,
  roomId: string,
) {
  try {
    await challenges('/api/friends/challenges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, username, roomId }),
    });
  } catch {
    // The room page's invite link is the fallback.
  }
}

/**
 * Challenge an accepted friend (ADR 0072): confirm the friendship through
 * the friend list route, take the catalog's default format, and create
 * the room through the one room-create route, then deliver the challenge to
 * the friend, every call carrying the caller's own request. A member who is not a friend gets the same answer
 * as an outage.
 */
export async function challengeFriend({
  viewer,
  form,
  commandId,
  routes,
  create,
}: {
  readonly viewer: string;
  readonly form: FormData;
  readonly commandId: string;
  readonly routes: {
    readonly friends: FetchLike;
    readonly catalog: FetchLike;
    readonly challenges: FetchLike;
  };
  readonly create: (
    form: FormData,
    beforeMoveOn: (roomId: string) => Promise<void>,
  ) => Promise<MockFormState>;
}): Promise<ChallengeAnswer> {
  const friend = parseUsername(form.get('username'));
  if (!friend.ok || !(await isFriend(routes.friends, friend.username)))
    return challengeUnavailable;
  const catalog = await readRoomTemplates(routes.catalog);
  const template =
    catalog.kind === 'found' ? defaultChoice(catalog.choices) : undefined;
  if (!template) return challengeUnavailable;
  const created = await create(
    challengeRoomForm({ viewer, friend: friend.username, template, commandId }),
    (roomId) => deliverChallenge(routes.challenges, friend.username, roomId),
  );
  return created.next === undefined
    ? {
        username: '',
        notice: created.error ?? challengeUnavailable.notice ?? '',
      }
    : { username: '', next: created.next };
}
