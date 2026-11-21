'use client';

import { Button } from '../components/button/button';
import { StatusRegion } from '../components/status-region/status-region';
import { chosenStatuses, type ChosenStatus } from '@daisy/protocol';

import {
  initialPresenceForm,
  presenceFields,
  presenceFormUnavailable,
  type PresenceFormState,
} from '../../features/presence/form';
import { Avatar } from '../components/avatar/avatar';
import { Icon } from '../components/icon/icon';
import { presenceDotClass } from '../components/presence-dot/presence-dot-class';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { useOptionalPeople } from './people-provider';
import { profilePhotoSrc } from '../profile/photo-src';

const labels: Readonly<Record<ChosenStatus, string>> = {
  online: 'Online',
  busy: 'Busy',
  appearing_offline: 'Appear offline',
};

/**
 * The avatar at the foot of the left rail, showing the member's real status
 * and the photo they published (ADR 0143).
 */
export function SelfAvatar({
  name,
  photoId,
  size = 'sm',
}: {
  /** The display name if they chose one, else the username: the initials' source. */
  readonly name: string;
  readonly photoId: string | null;
  readonly size?: 'sm' | 'md';
}) {
  const people = useOptionalPeople();
  return (
    <Avatar
      name={name}
      src={profilePhotoSrc(photoId, 128)}
      size={size}
      {...(people ? { presence: people.list.self } : {})}
    />
  );
}

function StatusChoice({
  status,
  current,
  pending,
}: {
  readonly status: ChosenStatus;
  readonly current: ChosenStatus;
  readonly pending: boolean;
}) {
  return (
    <Button
      variant="unstyled"
      type="submit"
      name="status"
      value={status}
      aria-pressed={status === current}
      disabled={pending}
      className="flex min-h-nav-target w-full items-center gap-2 rounded-sm px-3 text-left text-sm font-semibold text-ink-muted hover:bg-surface-overlay hover:text-ink aria-pressed:text-ink"
    >
      <span
        aria-hidden="true"
        className={presenceDotClass(
          status === 'appearing_offline' ? 'offline' : status,
        )}
      />
      {labels[status]}
      {status === current ? (
        <Icon name="check" size={16} className="ml-auto" />
      ) : null}
    </Button>
  );
}

/**
 * The member's own status (ADR 0103): one click, from any page. A native form
 * whose buttons each post their value, so it works before any script. Being in
 * a room or a Round shows over this on its own, and goes when they leave.
 */
export function StatusForm({
  action,
  chosen,
}: {
  readonly action: FormAction<PresenceFormState>;
  readonly chosen: ChosenStatus;
}) {
  const people = useOptionalPeople();
  const [answer, post, pending] = useFormAction(
    action,
    initialPresenceForm,
    presenceFormUnavailable,
    (next) => {
      if (presenceFields(next).status) people?.refresh();
    },
  );
  const { status, notice } = presenceFields(answer);
  const current = status ?? chosen;
  return (
    <form
      action={post}
      aria-label="Status"
      className="flex flex-col border-y border-border py-1"
    >
      {chosenStatuses.map((status) => (
        <StatusChoice
          key={status}
          status={status}
          current={current}
          pending={pending}
        />
      ))}
      {notice ? (
        <StatusRegion
          as="p"
          role="status"
          className="px-3 pb-1 text-xs text-ink-muted"
        >
          {notice}
        </StatusRegion>
      ) : null}
    </form>
  );
}
