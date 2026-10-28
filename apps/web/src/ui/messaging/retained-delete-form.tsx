'use client';

import { Button } from '../components/button/button';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { DraftNotice } from './draft-notice';

export type RetainedDeleteState = {
  readonly notice?: string;
  readonly next?: string;
};

const unavailable = (): RetainedDeleteState => ({
  notice: 'Could not reach Daisy. Try again.',
});

/** Deletes the survivor's whole retained conversation: one native button. */
export function RetainedDeleteForm({
  action,
}: {
  readonly action: FormAction<RetainedDeleteState>;
}) {
  const [answer, post, pending] = useFormAction(action, {}, unavailable);
  useFocusAfterAnswer(answer, 'retained-delete-notice', !pending);
  useMovedOn(answer.next);
  return (
    <form action={post} className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || answer.next !== undefined}
      >
        Delete this conversation
      </Button>
      <DraftNotice id="retained-delete-notice" notice={answer.notice} />
    </form>
  );
}
