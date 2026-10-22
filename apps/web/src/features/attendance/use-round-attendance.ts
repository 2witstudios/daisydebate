'use client';
import { useEffect, useRef } from 'react';
import { systemId } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import { createAttendanceHttpClient } from './http-client';
import { createAttendanceClient } from './client';

/** HTTP receipt production is independent of realtime, visibility and microphone permission. */
export function useRoundAttendance({
  view,
  actorId,
  reconnect: reconnectSource,
}: {
  readonly view: RoundView;
  readonly actorId: string;
  readonly reconnect?: {
    readonly subscribe: (listener: () => void) => () => void;
  };
}): void {
  const eligible = view.participants.some(
    (seat) =>
      'actorId' in seat &&
      seat.actorId === actorId &&
      seat.kind === 'human' &&
      seat.role !== 'judge',
  );
  const client = useRef<ReturnType<typeof createAttendanceClient> | null>(null);
  useEffect(() => {
    if (!eligible) return;
    const http = createAttendanceHttpClient({
      roundId: view.id,
      fetch,
      timeout: (ms) => AbortSignal.timeout(ms),
    });
    const consumer = createAttendanceClient({
      nextCommandId: () => systemId.next(),
      read: http.read,
      send: http.send,
    });
    client.current = consumer;
    const reconnect = () => {
      void consumer.reconnect();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') reconnect();
    };
    window.addEventListener('online', reconnect);
    const unsubscribe = reconnectSource?.subscribe(reconnect);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => {
      void consumer.heartbeat();
    }, 15000);
    return () => {
      client.current = null;
      consumer.stop();
      unsubscribe?.();
      window.clearInterval(timer);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [view.id, eligible, reconnectSource]);
  useEffect(() => {
    void client.current?.update(view);
  }, [view, eligible]);
}
