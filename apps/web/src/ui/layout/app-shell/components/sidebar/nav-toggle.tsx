'use client';

import { Icon } from '../../../../components/icon/icon';
import { useUiState, useUiStore } from '../../../../store/store';
import { dispatch, transactions } from '../../../../transactions';

/**
 * Collapses the sidebar to icons and expands it again, at the top of the
 * sidebar it controls, as the social rail's control is at the top of the
 * rail. Only where there is room to choose: on a narrow screen the sidebar
 * is icons only already, so the button is hidden.
 */
export function NavToggle() {
  const store = useUiStore();
  const collapsed = useUiState((state) => state.resources.nav) === 'collapsed';
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      onClick={() =>
        dispatch(store, transactions.setNav, collapsed ? 'auto' : 'collapsed')
      }
      className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-raised text-ink-muted hover:bg-surface-overlay hover:text-ink max-compact:hidden"
    >
      <Icon name="sidebar" size={20} />
    </button>
  );
}
