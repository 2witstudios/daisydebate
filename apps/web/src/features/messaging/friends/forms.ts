import { createAppError } from '@daisy/errors';
import type { FriendRelation } from '@daisy/protocol';
import { singleFormField } from '../forms/form-scope';

/** What each friend form button asks; `cancel` withdraws one's own request. */
const friendIntents = [
  'request',
  'accept',
  'decline',
  'cancel',
  'remove',
  'decline-challenge',
] as const;
export type FriendIntent = (typeof friendIntents)[number];

export type FriendFormState = {
  readonly username: string;
  readonly notice?: string;
  /** Where a hydrated page goes next; a native post got a 303 instead. */
  readonly next?: string;
};

/** Which route each intent posts to, and the body it sends. */
export function friendRouteFor(
  intent: FriendIntent,
  username: string,
  roomId = '',
) {
  if (intent === 'decline-challenge')
    return {
      route: 'declineChallenge',
      path: '/api/friends/challenges/decline',
      body: { version: 1, username, roomId },
    } as const;
  if (intent === 'request')
    return {
      route: 'request',
      path: '/api/friends',
      body: { version: 1, username },
    } as const;
  if (intent === 'accept' || intent === 'decline')
    return {
      route: 'respond',
      path: '/api/friends/respond',
      body: { version: 1, username, decision: intent },
    } as const;
  return {
    route: 'remove',
    path: '/api/friends/remove',
    body: { version: 1, username },
  } as const;
}

/** A form's two fields, each exactly once; the server validates the name. */
export function parseFriendForm(input: unknown) {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const intent = singleFormField(input, 'intent');
  if (!(friendIntents as readonly string[]).includes(intent))
    throw createAppError('VALIDATION');
  return {
    intent: intent as FriendIntent,
    username: singleFormField(input, 'username'),
    roomId:
      intent === 'decline-challenge' ? singleFormField(input, 'roomId') : '',
  };
}

const typedName = (form: FormData) => {
  const username = form.get('username');
  return typeof username === 'string' ? username : '';
};

/** A failed call keeps what was typed and says to try again. */
export const friendFormUnavailable = (form: FormData): FriendFormState => ({
  username: typedName(form),
  notice: 'Could not reach Daisy. Your entry is kept; try again.',
});

/** The confirmation for a change that went through. */
export function friendDoneNotice(
  intent: FriendIntent,
  username: string,
  relation: FriendRelation,
): string {
  if (intent === 'decline-challenge')
    return `Declined @${username}'s challenge.`;
  if (relation === 'friends') return `You and @${username} are now friends.`;
  switch (intent) {
    case 'request':
      return `Friend request sent to @${username}.`;
    case 'decline':
      return `Declined @${username}'s request.`;
    case 'cancel':
      return `Cancelled your request to @${username}.`;
    default:
      return `@${username} is no longer your friend.`;
  }
}

/** The refusal for an HTTP status, never naming a block or why. */
export function friendRefusalNotice(
  intent: FriendIntent,
  status: number,
): string {
  if (status === 400) return 'Enter a username: 3–32 letters, numbers, _ or -.';
  if (status === 404)
    return intent === 'request'
      ? 'No member with that username can take a friend request from you.'
      : 'That member is no longer available.';
  if (status === 409) return 'That request is no longer open.';
  if (status === 422) return 'You cannot add yourself as a friend.';
  if (status === 429)
    return 'You have reached a friend limit for now. Try again later.';
  return 'Could not change this friendship. Try again.';
}
