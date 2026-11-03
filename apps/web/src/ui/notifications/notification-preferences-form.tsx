'use client';
import type { NotificationPreferences } from '@daisy/protocol';
import { Button } from '../components/button/button';
import { useFormAction, type FormAction } from '../form-action/form-action';

export type NotificationPreferencesState = { readonly notice?: string };

const unavailable = (): NotificationPreferencesState => ({
  notice: 'Could not save. Try again.',
});

/** Which notifications are stored for you; it shows what was saved (ISSUE-1045). */
export function NotificationPreferencesForm({
  action,
  preferences,
}: {
  readonly action: FormAction<NotificationPreferencesState>;
  readonly preferences: Omit<NotificationPreferences, 'version'>;
}) {
  const [answer, post, pending] = useFormAction(action, {}, unavailable);
  return (
    <form
      action={post}
      aria-label="Notification preferences"
      className="flex flex-col gap-3"
    >
      <label className="flex items-center gap-2 text-base text-ink">
        <input
          type="checkbox"
          name="followed_debater_live"
          defaultChecked={preferences.followed_debater_live}
        />{' '}
        A debater I follow is on air
      </label>
      <label className="flex items-center gap-2 text-base text-ink">
        <input
          type="checkbox"
          name="recording_ready"
          defaultChecked={preferences.recording_ready}
        />{' '}
        A recording is ready to watch
      </label>
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
