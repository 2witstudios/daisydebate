'use client';

import type { NotificationKind, NotificationShell } from '@daisy/protocol';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  TOAST_INFORMATIONAL_MS,
  toastWaits,
} from '../../features/notifications/shell-policy';
import { cn } from '../cn';
import { buttonClass } from '../components/button/button-class';
import { Icon, type IconName } from '../components/icon/icon';

type Recent = NotificationShell['recent'][number];

/** One kind's look: its hue, its mark, what it is called and its one action. */
type ToastLook = {
  /** The mark's circle and glyph. */
  readonly hue: string;
  /** The eyebrow's colour: the same hue. */
  readonly ink: string;
  readonly icon: IconName;
  readonly eyebrow: string;
  readonly action: string;
};

/**
 * Each kind's toast, after the designed canvas (ADR 0144): the hue says what
 * kind of thing it is before the words do, and a kind that needs the member
 * now sits on the stage colours.
 */
const looks: Record<NotificationKind, ToastLook> = {
  followed_debater_live: {
    hue: 'bg-hue-sky-soft text-hue-sky',
    ink: 'text-hue-sky',
    icon: 'eye',
    eyebrow: 'On air',
    action: 'Watch',
  },
  recording_ready: {
    hue: 'bg-hue-plum-soft text-hue-plum',
    ink: 'text-hue-plum',
    icon: 'play',
    eyebrow: 'Recording',
    action: 'Watch it',
  },
  room_invitation: {
    hue: 'bg-hue-teal-soft text-hue-teal',
    ink: 'text-hue-teal',
    icon: 'gavel',
    eyebrow: 'Room invitation',
    action: 'Open the room',
  },
  challenge_received: {
    hue: 'bg-hue-clay-soft text-hue-clay',
    ink: 'text-hue-clay',
    icon: 'swords',
    eyebrow: 'Challenge',
    action: 'See challenge',
  },
  challenge_accepted: {
    hue: 'bg-stage-accent/20 text-stage-accent',
    ink: 'text-stage-accent',
    icon: 'swords',
    eyebrow: 'Your room is ready',
    action: 'Go to the room',
  },
  round_started: {
    hue: 'bg-stage-accent/20 text-stage-accent',
    ink: 'text-stage-accent',
    icon: 'play',
    eyebrow: 'Your Round has started',
    action: 'Go to the Round',
  },
  round_decision_released: {
    hue: 'bg-gold-soft text-gold',
    ink: 'text-gold',
    icon: 'trophy',
    eyebrow: 'Decision in',
    action: 'See the decision',
  },
  friend_request_received: {
    hue: 'bg-accent-soft text-accent',
    ink: 'text-accent',
    icon: 'users',
    eyebrow: 'Friend request',
    action: 'See request',
  },
  friend_request_accepted: {
    hue: 'bg-online/10 text-online',
    ink: 'text-online',
    icon: 'users',
    eyebrow: 'New friend',
    action: 'Open Friends',
  },
};

/**
 * One stored notification, presented while Daisy is open. It is a view of
 * the row, never its record: dismissing it only hides it here. An
 * informational one goes after ten seconds, held while it is hovered or
 * focused; one that asks for an answer stays until dismissed.
 */
export function NotificationToast({
  row,
  dismiss,
}: {
  readonly row: Recent;
  readonly dismiss: () => void;
}) {
  const look = looks[row.kind];
  const waits = toastWaits(row.kind);
  const [held, setHeld] = useState(false);
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);
  useEffect(() => {
    if (waits || held) return;
    const timer = setTimeout(
      () => dismissRef.current(),
      TOAST_INFORMATIONAL_MS,
    );
    return () => clearTimeout(timer);
  }, [waits, held]);
  // What starts now sits on the stage colours.
  const stage =
    row.kind === 'challenge_accepted' || row.kind === 'round_started';
  return (
    <article
      aria-label={look.eyebrow}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-lg border py-3 pr-1 pl-3 shadow-3',
        stage
          ? 'border-stage-accent bg-surface-stage text-stage-ink'
          : 'border-border bg-surface-raised text-ink',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-toast-mark flex-none items-center justify-center rounded-round',
          look.hue,
        )}
      >
        <Icon name={look.icon} className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          className={cn(
            'text-xs font-bold tracking-wide uppercase',
            stage ? 'text-stage-accent' : look.ink,
          )}
        >
          {look.eyebrow}
        </p>
        <p className="text-base">{row.text}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link
            href={row.href}
            onClick={dismiss}
            className={buttonClass('primary')}
          >
            {look.action}
          </Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className={cn(
          '-mt-2 flex size-toast-target flex-none cursor-pointer items-center justify-center rounded-md',
          stage ? 'text-stage-ink-muted' : 'text-ink-muted hover:text-ink',
        )}
      >
        <Icon name="close" className="size-4" />
      </button>
    </article>
  );
}
