import type { Page } from '@playwright/test';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol/realtime';
import { expect } from './fixtures';

/** A member's real issued ticket cannot observe or subscribe to a group without a grant. */
export async function proveGroupObservationRefusal(
  page: Page,
  channelId: string,
) {
  const result = await page.evaluate(
    async ({ channelId, v, protocolVersion }) => {
      const response = await fetch('/api/realtime/ticket', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Realtime ticket refused');
      const { ticket, socketUrl } = await response.json();
      return new Promise<{ denied: boolean; leaked: boolean }>(
        (resolve, reject) => {
          const socket = new WebSocket(socketUrl);
          let observationDenied = false;
          let subscriptionDenied = false;
          let leaked = false;
          const deadline = setTimeout(() => {
            socket.close();
            reject(new Error('Group refusal deadline'));
          }, 10_000);
          socket.onopen = () =>
            socket.send(
              JSON.stringify({ v, type: 'hello', protocolVersion, ticket }),
            );
          socket.onerror = () => {
            clearTimeout(deadline);
            reject(new Error('Group refusal socket failed'));
          };
          socket.onmessage = (event) => {
            const frame = JSON.parse(String(event.data));
            if (frame.type === 'ready') {
              socket.send(
                JSON.stringify({
                  v,
                  type: 'subscribe',
                  id: 'group-subscribe',
                  topic: `channel:${channelId}`,
                }),
              );
              socket.send(
                JSON.stringify({
                  v,
                  type: 'observe',
                  id: 'group-observe',
                  resource: { kind: 'channel-messages', id: channelId },
                }),
              );
            }
            if (
              [
                'subscribed',
                'event',
                'observation.ready',
                'observation.snapshot',
              ].includes(frame.type)
            )
              leaked = true;
            if (
              frame.type === 'error' &&
              frame.id === 'group-subscribe' &&
              frame.code === 'AUTHORIZATION'
            )
              subscriptionDenied = true;
            if (
              frame.type === 'observation.state' &&
              frame.id === 'group-observe' &&
              frame.state === 'denied'
            )
              observationDenied = true;
            if (subscriptionDenied && observationDenied) {
              clearTimeout(deadline);
              socket.close();
              resolve({ denied: true, leaked });
            }
          };
        },
      );
    },
    { channelId, v: ENVELOPE_VERSION, protocolVersion: PROTOCOL_VERSION },
  );
  expect(result).toEqual({ denied: true, leaked: false });
}
