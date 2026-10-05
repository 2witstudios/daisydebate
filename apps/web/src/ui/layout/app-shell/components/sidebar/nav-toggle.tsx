'use client';

import { Icon } from '../../../../components/icon/icon';
import { useUiState, useUiStore } from '../../../../store/store';
import { dispatch, transactions } from '../../../../transactions';

/**
 * Collapses the sidebar to icons and expands it again, in the sidebar's
 * header on the side facing the page; its chevron points the way the sidebar
 * will move. Only where there is room to choose: on a narrow screen the
 * sidebar is icons only already, so the button is hidden.
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
      className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-surface-overlay hover:text-ink max-compact:hidden"
    >
      <Icon name={collapsed ? 'panelLeftOpen' : 'panelLeftClose'} size={20} />
    </button>
  );
}
