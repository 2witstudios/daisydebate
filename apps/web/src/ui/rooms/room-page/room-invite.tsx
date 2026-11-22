'use client';

import { Button } from '../../components/button/button';
import { StatusRegion } from '../../components/status-region/status-region';
import { useState, useSyncExternalStore } from 'react';
import { buttonClass } from '../../components/button/button-class';
const subscribeNever = () => () => undefined;

/** A room URL never grants private-room membership. */
export function RoomInvite({
  roomId,
  visibility,
  label,
  className = buttonClass('secondary'),
}: {
  readonly roomId: string;
  readonly visibility: string;
  readonly label: string;
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
      <a href={href} className={className}>
        {label}
      </a>
    );
  return (
    <span className="relative inline-flex">
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void copy()}
        className={className}
      >
        {label}
      </Button>
      <StatusRegion
        as="span"
        role="status"
        className="absolute top-full right-0 mt-1 text-sm whitespace-nowrap text-ink-muted"
      >
        {notice}
      </StatusRegion>
    </span>
  );
}
