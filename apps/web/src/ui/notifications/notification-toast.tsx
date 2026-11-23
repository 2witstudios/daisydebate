'use client';

import { useDelay } from '../edge/use-tick';
import { Button } from '../components/button/button';
import type {
  NotificationKind,
  NotificationShell,
} from '@daisy/protocol/notifications';
import Link from 'next/link';
import { useState } from 'react';
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
/** A media release notice (ADR 0151): one look, its own icon and action. */
const release = (mark: IconName, action: string): ToastLook => ({
  hue: 'bg-hue-plum-soft text-hue-plum',
  ink: 'text-hue-plum',
  icon: mark,
  eyebrow: 'Media release',
  action,
});

const looks: Record<NotificationKind, ToastLook> = {
  judge_assigned: {
    hue: 'bg-hue-teal-soft text-hue-teal',
    ink: 'text-hue-teal',
    icon: 'gavel',
    eyebrow: 'Judging',
    action: 'See the round',
  },
  judge_replaced: {
    hue: 'bg-hue-teal-soft text-hue-teal',
    ink: 'text-hue-teal',
    icon: 'gavel',
    eyebrow: 'Judging',
    action: 'Open the tournament',
  },
  judge_unassigned: {
    hue: 'bg-hue-teal-soft text-hue-teal',
    ink: 'text-hue-teal',
    icon: 'gavel',
    eyebrow: 'Judging',
    action: 'Open the tournament',
  },
  tournament_draw_changed: {
    hue: 'bg-hue-sky-soft text-hue-sky',
    ink: 'text-hue-sky',
    icon: 'swords',
    eyebrow: 'Tournament draw',
    action: 'See the draw',
  },
  tournament_room_ready: {
    hue: 'bg-stage-accent/20 text-stage-accent',
    ink: 'text-stage-accent',
    icon: 'play',
    eyebrow: 'Tournament room',
    action: 'Go to the room',
  },
  tournament_results_released: {
    hue: 'bg-gold-soft text-gold',
    ink: 'text-gold',
    icon: 'trophy',
    eyebrow: 'Tournament results',
    action: 'See the results',
  },
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
  friend_guardian_approval: {
    hue: 'bg-accent-soft text-accent',
    ink: 'text-accent',
    icon: 'users',
    eyebrow: 'Friend request approval',
    action: 'Review request',
  },
  friend_request_accepted: {
    hue: 'bg-online/10 text-online',
    ink: 'text-online',
    icon: 'users',
    eyebrow: 'New friend',
    action: 'Open Friends',
  },
  dm_request: {
    hue: 'bg-accent-soft text-accent',
    ink: 'text-accent',
    icon: 'message',
    eyebrow: 'Message request',
    action: 'See request',
  },
  media_release_requested: release('send', 'Send again'),
  media_release_declined: release('lock', 'See your release'),
  media_release_signed: release('check', 'See your release'),
  media_release_club_confirmed: release('check', 'See your release'),
  media_release_withdrawn: release('lock', 'See the release'),
  media_release_club_asked: release('users', 'Confirm releases'),
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
  useDelay(dismiss, waits || held ? null : TOAST_INFORMATIONAL_MS);
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
      <Button
        variant="icon"
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className={cn(
          '-mt-2 size-toast-target flex-none rounded-md',
          stage ? 'text-stage-ink-muted' : 'text-ink-muted hover:text-ink',
        )}
      >
        <Icon name="close" className="size-4" />
      </Button>
    </article>
  );
}
