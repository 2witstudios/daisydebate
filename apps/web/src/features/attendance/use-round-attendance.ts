'use client';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { systemId } from '@daisy/clock';
import { attendanceReceiptSchema, type RoundView } from '@daisy/protocol';
import { createAttendanceClient } from './client';

const closedWindow = z.object({
  refusal: z.enum([
    'attendance-finalized',
    'attendance-terminal',
    'attendance-window-closed',
  ]),
});
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
    const consumer = createAttendanceClient({
      nextCommandId: () => systemId.next(),
      send: async (command) => {
        const response = await fetch(`/api/rounds/${view.id}/check-in`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, ...command }),
        });
        if (
          response.status === 409 &&
          closedWindow.safeParse(
            await response
              .clone()
              .json()
              .catch(() => null),
          ).success
        )
          return 'closed';
        if (!response.ok) return false;
        const parsed = attendanceReceiptSchema.safeParse(await response.json());
        return (
          parsed.success &&
          parsed.data.commandId === command.commandId &&
          parsed.data.segmentId === command.segmentId &&
          parsed.data.roundId === view.id
        );
      },
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
