'use client';
import {
  notificationChannelsOf,
  notificationKinds,
  type NotificationChannel,
  type NotificationChoices,
  type NotificationKind,
} from '@daisy/protocol';
import {
  choiceField,
  chosen,
} from '../../features/notifications/preference-form';
import { Button } from '../components/button/button';
import { useFormAction, type FormAction } from '../form-action/form-action';

export type NotificationPreferencesState = { readonly notice?: string };

const unavailable = (): NotificationPreferencesState => ({
  notice: 'Could not save. Try again.',
});

const kindLabel: Record<NotificationKind, string> = {
  followed_debater_live: 'A debater I follow is on air',
  recording_ready: 'A recording is ready to watch',
  room_invitation: 'A host invites me to a room',
  challenge_received: 'Someone challenges me',
};
const channelLabel: Record<NotificationChannel, string> = {
  in_app: 'In Daisy',
  email: 'Email',
};

/**
 * Which notifications reach you, and how: each kind's in-app and email
 * channel (ADR 0124). It shows what was saved (ISSUE-1045), and a kind only
 * offers the channels it is really sent on.
 */
export function NotificationPreferencesForm({
  action,
  choices,
}: {
  readonly action: FormAction<NotificationPreferencesState>;
  readonly choices: NotificationChoices;
}) {
  const [answer, post, pending] = useFormAction(action, {}, unavailable);
  return (
    <form
      action={post}
      aria-label="Notification preferences"
      className="flex flex-col gap-3"
    >
      {notificationKinds.map((kind) => (
        <fieldset key={kind} className="flex flex-col gap-1">
          <legend className="text-base text-ink">{kindLabel[kind]}</legend>
          <div className="flex flex-wrap gap-4">
            {notificationChannelsOf[kind].map((channel) => (
              <label
                key={channel}
                className="flex items-center gap-2 text-sm text-ink-muted"
              >
                <input
                  type="checkbox"
                  name={choiceField(kind, channel)}
                  defaultChecked={chosen(choices, kind, channel)}
                />{' '}
                {channelLabel[channel]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
        {answer.notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {answer.notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
