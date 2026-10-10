import type { SQL } from 'bun';
import { serverMessageSchema, type ServerMessage } from '@daisy/protocol';

type TypingHint = Extract<ServerMessage, { type: 'typing_changed' }>;
export type RealtimeHintHandlers = {
  readonly onNotify: (frame: TypingHint) => void;
  readonly onListen: () => void;
};

function parseHint(payload: string): TypingHint | null {
  // No valid channel-only frame approaches this parse-cost bound.
  if (payload.length > 256) return null;
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(payload), {
      jitless: true,
    });
    return result.success && result.data.type === 'typing_changed'
      ? result.data
      : null;
  } catch {
    return null;
  }
}

/** Lossy hints only; no outbox position, replay guarantee or authority grant. */
export async function subscribeRealtimeHints(
  client: SQL,
  handlers: RealtimeHintHandlers,
): Promise<{ readonly unlisten: () => Promise<void> }> {
  let closed = false;
  const subscription = await client.listen(
    'daisy_realtime_hints',
    (payload: string) => {
      if (closed) return;
      const frame = parseHint(payload);
      if (frame) handlers.onNotify(frame);
    },
    () => {
      if (!closed) handlers.onListen();
    },
  );
  return {
    async unlisten() {
      if (closed) return;
      closed = true;
      await subscription.unlisten();
    },
  };
}
