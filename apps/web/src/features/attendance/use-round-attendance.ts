'use client';
import { useEffect, useRef } from 'react';
import { systemId } from '@daisy/clock';
import { attendanceReceiptSchema, type RoundView } from '@daisy/protocol';
import { createAttendanceClient } from './client';

/** HTTP receipt production is independent of realtime, visibility and microphone permission. */
export function useRoundAttendance({
  view,
  actorId,
}: {
  readonly view: RoundView;
  readonly actorId: string;
}): void {
  const current = useRef(view);
  current.current = view;
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
    void consumer.update(current.current);
    const reconnect = () => {
      void consumer.reconnect();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') reconnect();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => {
      void consumer.heartbeat();
    }, 15000);
    return () => {
      client.current = null;
      consumer.stop();
      window.clearInterval(timer);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [view.id, eligible]);
  useEffect(() => {
    void client.current?.update(view);
  }, [view]);
}
