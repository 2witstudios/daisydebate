'use client';

import { Button } from '../components/button/button';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { destinationOf } from '../../features/forms/form-state';
import {
  initialRetainedDelete,
  retainedDeleteNotice,
  retainedDeleteUnavailable,
  type RetainedDeleteState,
} from '../../features/messaging/forms/retained-delete-form';
import { DraftNotice } from './draft-notice';

/** Deletes the survivor's whole retained conversation: one native button. */
export function RetainedDeleteForm({
  action,
}: {
  readonly action: FormAction<RetainedDeleteState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialRetainedDelete,
    retainedDeleteUnavailable,
  );
  useFocusAfterAnswer(answer, 'retained-delete-notice', !pending);
  const next = destinationOf(answer);
  useMovedOn(next);
  return (
    <form action={post} className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || next !== undefined}
      >
        Delete this conversation
      </Button>
      <DraftNotice
        id="retained-delete-notice"
        notice={retainedDeleteNotice(answer)}
      />
    </form>
  );
}
