'use client';
import { StatusRegion } from '../components/status-region/status-region';
import type { NotificationPresentation } from '@daisy/protocol';
import {
  initialSaveForm,
  saveNotice,
  saveRefused,
  type SaveFormState,
} from '../../features/forms/save-form';
import { Button } from '../components/button/button';
import { useFormAction, type FormAction } from '../form-action/form-action';

const switches: readonly {
  readonly name: keyof NotificationPresentation;
  readonly label: string;
}[] = [
  { name: 'toasts', label: 'Show new notifications as pop-ups in Daisy' },
  { name: 'sound', label: 'Play a sound when something needs me now' },
  {
    name: 'desktopAlerts',
    label: 'Alert me on this device when Daisy is in another tab',
  },
  { name: 'email', label: 'Email me about notifications while I am away' },
];

/**
 * The browser asks once, when the member turns desktop alerts on: a choice
 * they just made, never a prompt on arrival.
 */
const askForDesktopAlerts = (event: { readonly target: HTMLInputElement }) => {
  if (
    event.target.checked &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default'
  )
    void Notification.requestPermission();
};

/**
 * How Daisy tells the member, and whether it emails them at all (ADR 0144).
 * The inbox keeps every notification whatever these say.
 */
export function NotificationPresentationForm({
  action,
  presentation,
}: {
  readonly action: FormAction<SaveFormState>;
  readonly presentation: NotificationPresentation;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialSaveForm,
    saveRefused,
  );
  const notice = saveNotice(answer);
  return (
    <form
      action={post}
      aria-label="How Daisy tells you"
      className="flex flex-col gap-3"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base text-ink">How Daisy tells you</legend>
        {switches.map(({ name, label }) => (
          <label
            key={name}
            className="flex items-center gap-2 text-sm text-ink-muted"
          >
            <input
              type="checkbox"
              name={name}
              defaultChecked={presentation[name]}
              onChange={
                name === 'desktopAlerts' ? askForDesktopAlerts : undefined
              }
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
        {notice ? (
          <StatusRegion as="p" role="status" className="text-sm text-ink-muted">
            {notice}
          </StatusRegion>
        ) : null}
      </div>
    </form>
  );
}
