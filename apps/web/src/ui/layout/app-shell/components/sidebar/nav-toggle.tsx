'use client';

import { useUiState, useUiStore } from '../../../../store/store';
import { dispatch, transactions } from '../../../../transactions';
import { EdgeTab } from '../edge-tab/edge-tab';

/**
 * Collapses the sidebar to icons and expands it again: a tab hanging off
 * the sidebar's inner edge, as the social rail's hangs off its own. Only
 * where there is room to choose: on a narrow screen the sidebar is icons
 * only already, so the tab is hidden.
 */
export function NavToggle() {
  const store = useUiStore();
  const collapsed = useUiState((state) => state.resources.nav) === 'collapsed';
  return (
    <EdgeTab
      side="right"
      label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      expanded={!collapsed}
      icon={collapsed ? 'chevronRight' : 'chevronLeft'}
      onClick={() =>
        dispatch(store, transactions.setNav, collapsed ? 'auto' : 'collapsed')
      }
      className="max-compact:hidden"
    />
  );
}
