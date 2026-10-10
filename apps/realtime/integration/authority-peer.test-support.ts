import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ServerMessage,
} from '@daisy/protocol';
import { testOrigin, waitFor } from './support';

/** Actual native transport; the caller issues a real single-use Redis ticket. */
export async function openAuthorityPeer(port: number, ticket: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: testOrigin },
  });
  const frames: ServerMessage[] = [];
  const closed = new Promise<number>((accept) =>
    socket.addEventListener('close', (event) => accept(event.code)),
  );
  socket.addEventListener('message', (event) =>
    frames.push(serverMessageSchema.parse(JSON.parse(String(event.data)))),
  );
  socket.addEventListener('open', () =>
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    ),
  );
  await waitFor(() => frames.some((frame) => frame.type === 'ready'));
  return {
    socket,
    frames,
    closed,
    async subscribe(topic: string, id: string, since?: string) {
      socket.send(
        JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'subscribe',
          id,
          topic,
          ...(since ? { since } : {}),
        }),
      );
      await waitFor(() =>
        frames.some((frame) => 'id' in frame && frame.id === id),
      );
      return frames.find((frame) => 'id' in frame && frame.id === id)!;
    },
  };
}
