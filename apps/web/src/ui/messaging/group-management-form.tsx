'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import { destinationOf } from '../../features/forms/form-state';
import {
  groupManagementFields,
  groupManagementIdle,
  groupManagementUnavailable,
  type GroupManagementFormState,
} from '../../features/messaging/forms/group-management-form';
export function GroupManagementForm({
  title,
  targeted,
  requestId,
  action,
}: {
  readonly title: string;
  readonly targeted: boolean;
  readonly requestId: string;
  readonly action: FormAction<GroupManagementFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    groupManagementIdle(requestId),
    groupManagementUnavailable,
  );
  const next = destinationOf(answer);
  useMovedOn(next);
  const fields = groupManagementFields(answer);
  useFocusAfterAnswer(
    answer,
    fields.notice ? 'group-management-notice' : 'group-management-submit',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <input type="hidden" name="requestId" value={fields.requestId} />
      {targeted ? (
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Member username
          <input
            name="memberUsername"
            key={fields.memberUsername}
            defaultValue={fields.memberUsername}
            required
            disabled={pending}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink"
          />
        </label>
      ) : null}
      <DraftNotice id="group-management-notice" notice={fields.notice} />
      <Button
        id="group-management-submit"
        type="submit"
        disabled={pending || next !== undefined}
      >
        {title}
      </Button>
    </form>
  );
}
