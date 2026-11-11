import { createAppError } from '@daisy/errors';
import type { FriendRelation } from '@daisy/protocol';
import { singleFormField } from '../../server/form-field';
import type { Idle, Refused } from '../forms/form-state';

/** What each friend form button asks; `cancel` withdraws one's own request. */
const friendIntents = [
  'request',
  'accept',
  'decline',
  'cancel',
  'remove',
] as const;
export type FriendIntent = (typeof friendIntents)[number];

type Named = { readonly values: { readonly username: string } };
type FriendIdle = Idle & Named;
type FriendRefused = Refused & Named;

/** The friendship changed; `notice` confirms how. */
export type FriendChanged = {
  readonly kind: 'changed';
  readonly notice: string;
};

/** What a friend form answers; a refusal keeps the username it was about. */
export type FriendFormState = FriendIdle | FriendRefused | FriendChanged;

/** Add-a-friend starts empty; a button about one member starts with their name. */
export const initialFriendForm = (username = ''): FriendFormState => ({
  kind: 'idle',
  values: { username },
});

export const friendRefused = (
  username: string,
  error: string,
): FriendRefused => ({ kind: 'refused', values: { username }, error });

export const friendChanged = (notice: string): FriendChanged => ({
  kind: 'changed',
  notice,
});

/** What a friend form renders: the username in its field and the notice beside it. */
export type FriendFields = {
  readonly username: string;
  readonly notice: string | undefined;
};

export function friendFields(answer: FriendFormState): FriendFields {
  switch (answer.kind) {
    case 'idle':
      return { username: answer.values.username, notice: undefined };
    case 'refused':
      return { username: answer.values.username, notice: answer.error };
    case 'changed':
      return { username: '', notice: answer.notice };
  }
}

/** Which route each intent posts to, and the body it sends. */
export function friendRouteFor(intent: FriendIntent, username: string) {
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
  };
}

const typedName = (form: FormData) => {
  const username = form.get('username');
  return typeof username === 'string' ? username : '';
};

/** A failed call keeps what was typed and says to try again. */
export const friendFormUnavailable = (form: FormData): FriendRefused =>
  friendRefused(
    typedName(form),
    'Could not reach Daisy. Your entry is kept; try again.',
  );

/** The confirmation for a change that went through. */
export function friendDoneNotice(
  intent: FriendIntent,
  username: string,
  relation: FriendRelation,
): string {
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
