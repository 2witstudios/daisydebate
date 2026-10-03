'use client';

import { Icon } from '../../../../components/icon/icon';
import { useUiState } from '../../../../store/store';
import { onlineNow } from '../chat-dock/dock-people';
import { useDock } from './use-dock';

/** The topbar button that opens and closes the friends dock. */
export function DockToggle() {
  const { open, setDock } = useDock();
  const users = useUiState((state) => state.collections.onlineUsers);
  return (
    <button
      type="button"
      aria-label="Friends"
      aria-expanded={open}
      aria-controls="friends-dock"
      onClick={() => setDock(open ? 'closed' : 'open')}
      className="relative flex shrink-0 cursor-pointer items-center rounded-md p-2 text-ink-muted hover:bg-surface-overlay"
    >
      <Icon name="users" size={20} />
      <span className="absolute top-0 right-0 min-w-4 rounded-round bg-accent px-1 text-center text-2xs font-bold text-accent-ink tabular-nums">
        {onlineNow(users)}
      </span>
    </button>
  );
}
