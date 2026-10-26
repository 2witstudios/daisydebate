import type { Page } from '@playwright/test';
import { serverMessageSchema, type ServerMessage } from '@daisy/protocol';

/** A received frame the realtime server's schema accepts, else null. */
export function serverFrame(payload: string | Buffer): ServerMessage | null {
  try {
    const frame = serverMessageSchema.safeParse(JSON.parse(String(payload)));
    return frame.success ? frame.data : null;
  } catch {
    return null;
  }
}

/**
 * Every answer the realtime server gives the watched pages' subscribes:
 * refusals of any code, and the topics each page was subscribed to. A
 * journey asserts no refusal, so a refused first subscribe fails it even
 * though the page would recover by retrying.
 */
export function subscriptionLedger() {
  const refusals: string[] = [];
  const subscribed: string[] = [];
  return {
    refusals,
    subscribed,
    watch(page: Page, label: string) {
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname !== '/ws') return;
        const requested = new Map<string, string>();
        socket.on('framesent', ({ payload }) => {
          try {
            const frame = JSON.parse(String(payload)) as {
              type?: string;
              id?: string;
              topic?: string;
            };
            if (frame.type === 'subscribe' && frame.id && frame.topic)
              requested.set(frame.id, frame.topic);
          } catch {
            return;
          }
        });
        socket.on('framereceived', ({ payload }) => {
          const frame = serverFrame(payload);
          if (frame?.type === 'error')
            refusals.push(
              `${label} ${requested.get(frame.id ?? '') ?? 'connection'} ${frame.code}: ${frame.message}`,
            );
          if (frame?.type === 'subscribed')
            subscribed.push(`${label} ${frame.topic}`);
        });
      });
    },
  };
}
