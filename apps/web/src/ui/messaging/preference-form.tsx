'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import {
  preferenceUnavailable,
  type PreferenceFormState,
} from '../../features/messaging/forms/preference-form';
export function PreferenceForm({
  state,
  action,
}: {
  readonly state: PreferenceFormState;
  readonly action: FormAction<PreferenceFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    state,
    preferenceUnavailable,
  );
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'preference-notice' : 'preference-save',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      {(
        [
          {
            name: 'following',
            label: 'Follow this conversation',
            value: answer.following,
          },
          {
            name: 'hidden',
            label: 'Hide from inbox',
            value: answer.hidden,
          },
        ] as const
      ).map(({ name, label, value }) => (
        <label key={name} className="flex flex-col gap-2">
          {label}
          <select
            name={name}
            key={value}
            defaultValue={value}
            disabled={pending}
            required
          >
            <option value="">Choose</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      ))}
      <label className="flex flex-col gap-2">
        Notification preference
        <select
          name="notificationLevel"
          key={answer.notificationLevel}
          defaultValue={answer.notificationLevel}
          disabled={pending}
          required
        >
          <option value="">Choose</option>
          <option value="all">All</option>
          <option value="mentions">Mentions</option>
          <option value="none">None</option>
        </select>
      </label>
      <DraftNotice id="preference-notice" notice={answer.notice} />
      <Button
        id="preference-save"
        type="submit"
        name="operation"
        value="update"
        disabled={pending}
      >
        Save preferences
      </Button>
      <Button
        type="submit"
        name="operation"
        value="clear"
        formNoValidate
        disabled={pending}
      >
        Clear saved preferences
      </Button>
    </form>
  );
}
