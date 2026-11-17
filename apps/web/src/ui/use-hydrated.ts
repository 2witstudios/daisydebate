'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * False on the server render and the hydration pass, true after: for output
 * that reads this device (its clock, its storage) and must not guess on the
 * server.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
