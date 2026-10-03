'use client';

import { Icon } from '../../../../components/icon/icon';
import { useUiState, useUiStore } from '../../../../store/store';
import { dispatch, transactions } from '../../../../transactions';

/**
 * Collapses the sidebar to icons and expands it again: a panel button in a
 * header row at the top of the sidebar, level with the topbar. Only where
 * there is room to choose; on a narrow screen the sidebar is icons only
 * already, so the button is hidden and the row just keeps the line.
 */
export function NavToggle() {
  const store = useUiStore();
  const collapsed = useUiState((state) => state.resources.nav) === 'collapsed';
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <div className="flex h-topbar items-center border-b border-border px-4 icons:justify-center icons:px-0">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={!collapsed}
        onClick={() =>
          dispatch(store, transactions.setNav, collapsed ? 'auto' : 'collapsed')
        }
        className="flex size-10 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-surface-overlay hover:text-ink max-compact:hidden"
      >
        <Icon name="sidebar" size={20} />
      </button>
    </div>
  );
}
