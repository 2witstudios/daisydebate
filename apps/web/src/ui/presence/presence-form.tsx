'use client';

import {
  presenceFormUnavailable,
  type PresenceFormState,
} from '../../features/presence/form';
import { Button } from '../components/button/button';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { DraftNotice } from '../messaging/draft-notice';

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
