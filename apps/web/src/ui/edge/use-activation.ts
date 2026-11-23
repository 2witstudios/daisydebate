'use client';

import { useLayoutEffect } from 'react';

/** An owner built during render that may act only while it is on the page. */
export type Activatable = {
  readonly activate: () => void;
  readonly close: () => void;
};

/**
 * Activates the owner when the render that built it commits, before the
 * browser paints, and closes it when it is replaced or leaves the page.
 */
export function useActivation(owner: Activatable): void {
  useLayoutEffect(() => {
    owner.activate();
    return owner.close;
  }, [owner]);
}
