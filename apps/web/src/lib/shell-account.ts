import type { Identity } from '@daisy/auth';
import type { ShellAccount } from '../ui/layout/app-shell/account';

/** What a member shows besides the username; null when it was not read. */
type ShownCard = {
  readonly displayName: string | null;
  readonly photoId: string | null;
};

/**
 * The only fields the client shell learns: never account ids, roles or
 * permissions. A member's published photo id is public: anyone may load it.
 * During a session-store outage the shell offers sign-in, which is where a
 * visitor can recover once the store is back.
 */
export const shellAccount = (
  identity: Identity,
  card: ShownCard | null = null,
): ShellAccount => {
  if (identity.state === 'member')
    return {
      state: 'member',
      username: identity.username,
      displayName: card?.displayName ?? null,
      photoId: card?.photoId ?? null,
    };
  if (
    identity.state === 'provisional' ||
    identity.state === 'waitlisted' ||
    identity.state === 'restricted'
  )
    return { state: identity.state };
  return { state: 'anonymous' };
};
