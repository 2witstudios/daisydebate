'use client';
import type { NotificationPreferences } from '@daisy/protocol';
import { ActionForm, type FormStateAction } from '../form-action/action-form';
import { Button } from '../components/button/button';

/** Which notifications are stored for you; it shows what was saved (ISSUE-1045). */
export function NotificationPreferencesForm({
  action,
  preferences,
  saved,
}: {
  readonly action: FormStateAction;
  readonly preferences: Omit<NotificationPreferences, 'version'>;
  readonly saved: boolean;
}) {
  return (
    <ActionForm
      action={action}
      label="Notification preferences"
      className="flex flex-col gap-3"
    >
      {({ error, pending }) => (
        <>
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
            {error ? (
              <p role="alert" className="text-sm text-live">
                {error}
              </p>
            ) : saved ? (
              <p role="status" className="text-sm text-ink-muted">
                Saved.
              </p>
            ) : null}
          </div>
        </>
      )}
    </ActionForm>
  );
}
