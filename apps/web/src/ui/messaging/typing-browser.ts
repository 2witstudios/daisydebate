'use client';
import type { BrowserTransport } from '../edge/browser-request';
import { systemScheduler } from '../edge/realtime-browser';
import type { ConnectionStore } from '../../features/realtime/connection-store';
import { attachTypingReader } from '../../features/messaging/typing-reader';
import { createTypingWriter } from '../../features/messaging/typing-writer';
/** Native browser I/O edges; neither adapter receives message content. Renewal follows the server's timing; a transient failure (dropped, 408, 429, 5xx) backs off up to TYPING_RETRY_MAX_MS, and a refusal (other 4xx) stops. */
export const createBrowserTypingReader = (
  channelId: string,
  connection: ConnectionStore,
  publish: (typing: boolean | null) => void,
  recoveryAfterMs: number | null,
  transport: BrowserTransport,
) =>
  attachTypingReader({
    channelId,
    connection,
    timers: systemScheduler,
    publish,
    recoveryAfterMs,
    read: () =>
      transport(`/api/messaging/channels/${channelId}/typing`, {
        credentials: 'same-origin',
      }),
  });
export const createBrowserTypingWriter = (
  channelId: string,
  transport: BrowserTransport,
) =>
  createTypingWriter({
    channelId,
    timers: systemScheduler,
    write: (typing) =>
      transport('/api/messaging/typing', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, channelId, typing }),
      }),
  });
