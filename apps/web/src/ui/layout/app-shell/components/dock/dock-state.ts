import type { DockState } from '../../../../store/state';

/** The width from which the dock is open on its own, beside the page. */
export const wideQuery = '(min-width: 1101px)';

/** Whether the dock is open: a choice wins, otherwise the screen decides. */
export const dockOpen = (dock: DockState, wide: boolean): boolean =>
  dock === 'open' || (dock === 'auto' && wide);
