import type { Page } from '@playwright/test';
import { buildDebateTopic, serverMessageSchema } from '@daisy/protocol';
import { expect } from './fixtures';

/** Observe the mounted production connection; never create a test transport. */
export function observeAttendanceSockets(page: Page) {
  const connections: {
    secure: boolean;
    ready: boolean;
    closed: boolean;
    topics: Set<string>;
  }[] = [];
  page.on('websocket', (socket) => {
    const observation = {
      secure: new URL(socket.url()).protocol === 'wss:',
      ready: false,
      closed: false,
      topics: new Set<string>(),
    };
    connections.push(observation);
    socket.on('close', () => {
      observation.closed = true;
    });
    socket.on('framereceived', ({ payload }) => {
      let value: unknown;
      try {
        value = JSON.parse(payload.toString());
      } catch {
        return;
      }
      const parsed = serverMessageSchema.safeParse(value);
      if (!parsed.success) return;
      if (parsed.data.type === 'ready') observation.ready = true;
      if (parsed.data.type === 'subscribed')
        observation.topics.add(parsed.data.topic);
    });
  });
  return connections;
}

/** One open secure authenticated subscription; reconnects replace, never duplicate, the socket. */
export async function authenticatedAttendanceSocket(
  connections: ReturnType<typeof observeAttendanceSockets>,
  roundId: string,
  minimumConnections = 1,
) {
  await expect
    .poll(
      () =>
        connections.filter((row) => row.topics.has(buildDebateTopic(roundId)))
          .length >= minimumConnections &&
        connections.filter((row) => !row.closed).length === 1 &&
        connections.some(
          (row) =>
            row.secure &&
            row.ready &&
            !row.closed &&
            row.topics.has(buildDebateTopic(roundId)),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}
