'use client';

import { useEffect, useEffectEvent } from 'react';

/** Follow a committed destination, including the caller's latest preparation. */
export function useNavigation<Router>(
  router: Router,
  destination: string | undefined,
  navigate: (router: Router, destination: string) => void,
) {
  const follow = useEffectEvent(navigate);
  useEffect(() => {
    if (destination !== undefined) follow(router, destination);
  }, [router, destination]);
}
