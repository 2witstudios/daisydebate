'use client';
import { Announcement } from '../components/announcement/announcement';
import type { MessageRequestSetting } from '@daisy/protocol/messaging/social';
import {
  initialSaveForm,
  saveNotice,
  saveRefused,
  type SaveFormState,
} from '../../features/forms/save-form';
import { Button } from '../components/button/button';
import { useFormAction, type FormAction } from '../form-action/form-action';

const choices: readonly {
  readonly value: MessageRequestSetting;
  readonly label: string;
}[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends only' },
  { value: 'none', label: 'No one' },
];

/**
 * The choice the form shows: after a refused save, the one it tried, so Save
 * again sends it again; otherwise the stored one.
 */
export function shownSetting(
  answer: SaveFormState,
  stored: MessageRequestSetting,
): MessageRequestSetting {
  const attempted =
    answer.kind === 'refused' ? answer.values['setting'] : undefined;
  return choices.find((choice) => choice.value === attempted)?.value ?? stored;
}

/**
 * Who can send the member a new message request (decision 90). It never
 * closes a conversation already accepted; declining and blocking are always
 * open.
 */
export function MessageRequestSettingForm({
  action,
  setting,
  locked = false,
}: {
  readonly action: FormAction<SaveFormState>;
  readonly setting: MessageRequestSetting;
  readonly locked?: boolean;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialSaveForm,
    saveRefused,
  );
  const notice = saveNotice(answer);
  const shown = shownSetting(answer, setting);
  return (
    <form
      action={post}
      aria-label="Message requests"
      className="flex flex-col gap-3"
    >
      <fieldset key={shown} disabled={locked} className="flex flex-col gap-2">
        <legend className="text-base text-ink">
          Who can send me message requests
        </legend>
        <div className="flex flex-wrap gap-4">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex items-center gap-2 text-sm text-ink-muted"
            >
              <input
                type="radio"
                name="setting"
                value={choice.value}
                defaultChecked={shown === choice.value}
              />{' '}
              {choice.label}
            </label>
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          Conversations you have already accepted stay open. You can always
          decline a request or block someone.
        </p>
      </fieldset>
      {locked ? (
        <p className="text-sm text-ink-muted">
          Your parent’s protection level keeps message requests set to Friends
          only.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Save
          </Button>
          {notice ? (
            <Announcement
              as="p"
              kind="progress"
              className="text-sm text-ink-muted"
            >
              {notice}
            </Announcement>
          ) : null}
        </div>
      )}
    </form>
  );
}
