export type RoomVisibility = {
  hidden: boolean;
  readonly addEventListener: (
    type: 'visibilitychange',
    listener: () => void,
  ) => void;
  readonly removeEventListener: (
    type: 'visibilitychange',
    listener: () => void,
  ) => void;
};

/** Rereads server state without replacing the page or writing form values. */
export function startRoomRefresh({
  visibility,
  every,
  refresh,
}: {
  readonly visibility: RoomVisibility;
  readonly every: (run: () => void, milliseconds: number) => () => void;
  readonly refresh: () => void;
}): () => void {
  let stopped = false;
  let cancel: (() => void) | undefined;
  const tick = () => {
    if (!stopped && !visibility.hidden) refresh();
  };
  const visible = () => {
    if (stopped) return;
    if (visibility.hidden) {
      cancel?.();
      cancel = undefined;
    } else if (cancel === undefined) {
      cancel = every(tick, 5000);
      tick();
    }
  };
  visibility.addEventListener('visibilitychange', visible);
  if (!visibility.hidden) cancel = every(tick, 5000);
  return () => {
    if (stopped) return;
    stopped = true;
    cancel?.();
    cancel = undefined;
    visibility.removeEventListener('visibilitychange', visible);
  };
}
