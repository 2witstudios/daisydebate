'use client';
import type { ConnectionStore } from '../../features/realtime/connection-store';
import { attachTypingReader } from '../../features/messaging/typing-reader';
import { createTypingWriter } from '../../features/messaging/typing-writer';
const timers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (id: unknown) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
};
/** Native browser I/O edges; neither adapter receives message content or invents a timing default. */
export const createBrowserTypingReader = (
  channelId: string,
  connection: ConnectionStore,
  publish: (typing: boolean | null) => void,
  recoveryAfterMs: number | null,
) =>
  attachTypingReader({
    channelId,
    connection,
    timers,
    publish,
    recoveryAfterMs,
    read: () =>
      fetch(`/api/messaging/channels/${channelId}/typing`, {
        credentials: 'same-origin',
      }),
  });
export const createBrowserTypingWriter = (channelId: string) =>
  createTypingWriter({
    channelId,
    timers,
    write: (typing) =>
      fetch('/api/messaging/typing', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, channelId, typing }),
      }),
  });
