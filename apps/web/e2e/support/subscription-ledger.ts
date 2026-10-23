import type { Page } from '@playwright/test';
import { serverMessageSchema } from '@daisy/protocol';

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
          let raw: unknown;
          try {
            raw = JSON.parse(String(payload));
          } catch {
            return;
          }
          const frame = serverMessageSchema.safeParse(raw);
          if (!frame.success) return;
          if (frame.data.type === 'error')
            refusals.push(
              `${label} ${requested.get(frame.data.id ?? '') ?? 'connection'} ${frame.data.code}: ${frame.data.message}`,
            );
          if (frame.data.type === 'subscribed')
            subscribed.push(`${label} ${frame.data.topic}`);
        });
      });
    },
  };
}
