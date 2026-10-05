'use client';

import { Icon } from '../../../../components/icon/icon';
import { useUiState, useUiStore } from '../../../../store/store';
import { dispatch, transactions } from '../../../../transactions';

/**
 * Collapses the sidebar to icons and expands it again, at the foot of the
 * sidebar it controls. Only where there is room to choose: on a narrow
 * screen the sidebar is icons only already, so the button is hidden.
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
      className="mx-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-raised px-3 text-sm font-semibold text-ink-muted hover:bg-surface-overlay hover:text-ink max-compact:hidden icons:mx-2 icons:justify-center icons:px-0"
    >
      <Icon name="sidebar" size={20} />
      <span className="icons:hidden">Collapse</span>
    </button>
  );
}
