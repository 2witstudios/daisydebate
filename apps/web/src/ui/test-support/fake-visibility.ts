type Visibility = {
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

/**
 * Test support: a document stand-in for visibility-driven timers. `change`
 * flips `hidden` and notifies the registered listener; `listeners` counts
 * registrations still in place.
 */
export function fakeVisibility(hidden = false) {
  let changed: (() => void) | undefined;
  let listeners = 0;
  const visibility: Visibility = {
    hidden,
    addEventListener: (_type, listener) => {
      changed = listener;
      listeners += 1;
    },
    removeEventListener: (_type, listener) => {
      if (changed === listener) changed = undefined;
      listeners -= 1;
    },
  };
  return {
    visibility,
    change: (next: boolean) => {
      visibility.hidden = next;
      changed?.();
    },
    listeners: () => listeners,
  };
}
