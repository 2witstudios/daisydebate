'use client';

import { useEffect, useEffectEvent, type EffectCallback } from 'react';

/** Starts a browser lifetime after hydration and cleans it up on unmount. */
export function useMount(start: EffectCallback): void {
  const setup = useEffectEvent(start);
  useEffect(() => setup(), []);
}
