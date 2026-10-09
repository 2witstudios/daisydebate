'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { startRoomRefresh } from './room-refresh';

/** Next merges server updates while retaining mounted form/browser state. */
export function RoomRefresher() {
  const router = useRouter();
  useEffect(
    () =>
      startRoomRefresh({
        visibility: document,
        every: (run, milliseconds) => {
          const timer = window.setInterval(run, milliseconds);
          return () => window.clearInterval(timer);
        },
        refresh: () => router.refresh(),
      }),
    [router],
  );
  return null;
}
