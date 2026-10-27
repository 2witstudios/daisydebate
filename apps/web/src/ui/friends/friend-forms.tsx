'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../debate-room/zod-jitless';
import { useId } from 'react';
import {
  friendFormUnavailable,
  presenceFormUnavailable,
  type FriendFormState,
  type FriendIntent,
  type PresenceFormState,
} from '../../features/messaging/friends/forms';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { FormField } from '../components/form-field/form-field';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { DraftNotice } from '../messaging/draft-notice';

type Action = FormAction<FriendFormState>;

/** Add a friend by username: a native POST that works before any script. */
export function AddFriendForm({ action }: { readonly action: Action }) {
  const [answer, post, pending] = useFormAction(
    action,
    { username: '' },
    friendFormUnavailable,
  );
  useFocusAfterAnswer(answer, 'add-friend-notice', !pending);
  return (
    <form action={post} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="request" />
      <FormField id="add-friend-username" label="Username">
        <input
          id="add-friend-username"
          name="username"
          key={answer.username}
          defaultValue={answer.username}
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={pending}
          className={controlClass}
        />
      </FormField>
      <DraftNotice id="add-friend-notice" notice={answer.notice} />
      <div>
        <Button type="submit" disabled={pending}>
          Send friend request
        </Button>
      </div>
    </form>
  );
}

/**
 * One button acting on one member: accept, decline, cancel, remove or
 * challenge. Its answer shows beside it; a challenge moves on to its room.
 */
export function FriendButtonForm({
  action,
  username,
  intent,
  label,
  variant = 'secondary',
  roomId,
  accessibleName,
}: {
  readonly action: Action;
  readonly username: string;
  readonly intent: FriendIntent | 'challenge';
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  /** The challenge's room, for declining it. */
  readonly roomId?: string;
  /** The button's full name when `label @username` does not read right. */
  readonly accessibleName?: string;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    { username },
    friendFormUnavailable,
  );
  const noticeId = useId();
  useFocusAfterAnswer(answer, noticeId, !pending);
  useMovedOn(answer.next);
  return (
    <form action={post} className="flex items-center gap-2">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="username" value={username} />
      {roomId ? <input type="hidden" name="roomId" value={roomId} /> : null}
      <Button
        type="submit"
        variant={variant}
        disabled={pending || answer.next !== undefined}
        aria-label={accessibleName ?? `${label} @${username}`}
        className="px-3 py-2 text-sm"
      >
        {label}
      </Button>
      <DraftNotice id={noticeId} notice={answer.notice} />
    </form>
  );
}

/** Hide or show your online status to friends: one native button. */
export function PresenceForm({
  action,
  hidden,
}: {
  readonly action: FormAction<PresenceFormState>;
  readonly hidden: boolean;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    {},
    presenceFormUnavailable,
  );
  useFocusAfterAnswer(answer, 'presence-notice', !pending);
  return (
    <form action={post} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="hidden" value={hidden ? 'false' : 'true'} />
      <p className="text-base text-ink-muted">
        {hidden
          ? 'Friends see you as offline.'
          : 'Friends can see when you are online.'}
      </p>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        className="px-3 py-2 text-sm"
      >
        {hidden ? 'Show my online status' : 'Hide my online status'}
      </Button>
      <DraftNotice id="presence-notice" notice={answer.notice} />
    </form>
  );
}
