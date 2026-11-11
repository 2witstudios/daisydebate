import type { FriendRelation } from '@daisy/protocol';
import type { FriendFormState } from '../../features/friends/forms';
import type { FormAction } from '../form-action/form-action';
import { FriendButtonForm } from './friend-forms';

type Action = FormAction<FriendFormState>;

/**
 * What a member can do about a friendship from a profile (ADR 0072): add them,
 * answer or withdraw a request. Native forms, so each works before any script.
 */
export function ProfileFriendActions({
  username,
  relation,
  friendAction,
}: {
  readonly username: string;
  readonly relation: FriendRelation;
  readonly friendAction: Action;
}) {
  switch (relation) {
    case 'friends':
      return null;
    case 'incoming':
      return (
        <FriendButtonForm
          action={friendAction}
          username={username}
          intent="accept"
          label="Accept friend request"
          variant="primary"
        />
      );
    case 'outgoing':
      return (
        <FriendButtonForm
          action={friendAction}
          username={username}
          intent="cancel"
          label="Cancel friend request"
        />
      );
    case 'none':
      return (
        <FriendButtonForm
          action={friendAction}
          username={username}
          intent="request"
          label="Add friend"
          variant="primary"
        />
      );
  }
}
