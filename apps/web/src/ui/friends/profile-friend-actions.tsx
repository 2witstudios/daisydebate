import type { FriendRelation } from '@daisy/protocol';
import type { FriendFormState } from '../../features/messaging/friends/forms';
import type { FormAction } from '../form-action/form-action';
import { FriendButtonForm } from './friend-forms';

type Action = FormAction<FriendFormState>;

/**
 * What a member can do toward someone else from their profile (ADR 0072):
 * add them, answer or withdraw a request, or challenge a friend. Native
 * forms, so each works before any script.
 */
export function ProfileFriendActions({
  username,
  relation,
  friendAction,
  challengeAction,
}: {
  readonly username: string;
  readonly relation: FriendRelation;
  readonly friendAction: Action;
  readonly challengeAction: Action;
}) {
  switch (relation) {
    case 'friends':
      return (
        <FriendButtonForm
          action={challengeAction}
          username={username}
          intent="challenge"
          label="Challenge"
          variant="primary"
        />
      );
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
    default:
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
