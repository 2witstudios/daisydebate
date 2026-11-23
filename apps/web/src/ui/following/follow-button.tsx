'use client';
import { Announcement } from '../components/announcement/announcement';
import { ActionForm, type FormStateAction } from '../form-action/action-form';
import { Button } from '../components/button/button';

/** Follow or stop following a debater: a native post, and nothing it grants. */
export function FollowButton({
  username,
  following,
  action,
}: {
  readonly username: string;
  readonly following: boolean;
  readonly action: FormStateAction;
}) {
  return (
    <ActionForm
      action={action}
      label={following ? `Unfollow @${username}` : `Follow @${username}`}
    >
      {({ error, pending }) => (
        <>
          <Button type="submit" variant="secondary" disabled={pending}>
            {following ? 'Following' : 'Follow'}
          </Button>
          {error ? (
            <Announcement as="p" kind="problem" className="text-sm text-live">
              {error}
            </Announcement>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
