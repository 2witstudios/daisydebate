const base = 'flex w-rail shrink-0 flex-col gap-4 bg-surface p-5';

/**
 * The panel's frame. On desktop it is a column beside the room, or gone when
 * hidden. On the phone it is a sheet over the room when open and absent when
 * collapsed (the summary bar stands in).
 */
export function roomPanelClass(state: {
  readonly open: boolean;
  readonly hidden: boolean;
}): string {
  const desktop = state.hidden ? 'hidden' : 'border-l border-border';
  const phone = state.open
    ? 'max-compact:fixed max-compact:inset-x-0 max-compact:bottom-0 max-compact:z-10 max-compact:max-h-full max-compact:w-full max-compact:overflow-y-auto max-compact:rounded-t-xl max-compact:border-t max-compact:border-border-strong max-compact:shadow-3'
    : 'max-compact:hidden';
  return `${base} ${desktop} ${phone}`;
}

/** The phone scrim behind an open sheet. */
export const scrimClass =
  'fixed inset-0 z-10 hidden bg-scrim max-compact:block';
