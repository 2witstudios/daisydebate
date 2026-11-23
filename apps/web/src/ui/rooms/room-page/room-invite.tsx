'use client';

import { Button } from '../../components/button/button';
import { Announcement } from '../../components/announcement/announcement';
import { useState, useSyncExternalStore } from 'react';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { cn } from '../../cn';
const subscribeNever = () => () => undefined;

/** A room URL never grants private-room membership. */
export function RoomInvite({
  roomId,
  visibility,
  label,
  variant = 'secondary',
  className,
}: {
  readonly roomId: string;
  readonly visibility: string;
  readonly label: string;
  /** The look of the place it sits; the no-script link wears it too. */
  readonly variant?: ButtonVariant;
  readonly className?: string;
}) {
  const [notice, setNotice] = useState('');
  const interactive = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const href = `/rooms/${roomId}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(href, window.location.origin).href,
      );
      setNotice(
        visibility === 'private'
          ? 'Room link copied · room members only'
          : 'Room link copied',
      );
    } catch {
      setNotice('Copy the room link from your browser address bar.');
    }
  };
  if (!interactive)
    return (
      <a href={href} className={cn(buttonClass(variant), className)}>
        {label}
      </a>
    );
  return (
    <span className="relative inline-flex">
      <Button
        variant={variant}
        type="button"
        onClick={() => void copy()}
        className={className}
      >
        {label}
      </Button>
      <Announcement
        as="span"
        kind="progress"
        className="absolute top-full right-0 mt-1 text-sm whitespace-nowrap text-ink-muted"
      >
        {notice}
      </Announcement>
    </span>
  );
}
