'use client';

import { useState, useSyncExternalStore } from 'react';
import { buttonClass } from '../../components/button/button-class';
const subscribeNever = () => () => undefined;

/** A room URL never grants private-room membership. */
export function RoomInvite({
  roomId,
  visibility,
}: {
  readonly roomId: string;
  readonly visibility: string;
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
      setNotice('Room link copied.');
    } catch {
      setNotice('Copy the room link from your browser address bar.');
    }
  };
  return (
    <details className="min-w-0">
      <summary className={`${buttonClass('secondary')} list-none`}>
        Invite
      </summary>
      <div className="mt-3 flex max-w-search flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <a href={href} className="text-sm wrap-anywhere">
          Room link
        </a>
        {visibility === 'private' ? (
          <p className="text-sm text-ink-muted">
            Existing room access is required.
          </p>
        ) : null}
        <button
          type="button"
          disabled={!interactive}
          onClick={() => void copy()}
          className={buttonClass('secondary')}
        >
          Copy room link
        </button>
        <noscript>Copy the room link from your browser address bar.</noscript>
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
