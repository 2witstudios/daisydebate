import type { Page } from '@playwright/test';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol';

/** Actual issued tickets and native sockets; only fixed close codes leave the page. */
export async function nativeRealtimeRefusals(page: Page, endpoint: string) {
  return page.evaluate(
    async ({ endpoint, v, protocolVersion }) => {
      async function ticket() {
        const response = await fetch('/api/realtime/ticket', {
          method: 'POST',
          credentials: 'same-origin',
        });
        const body = await response.json();
        if (response.status !== 200 || body.socketUrl !== endpoint)
          throw new Error('Actual realtime ticket unavailable');
        return body.ticket as string;
      }
      async function closed(
        mode: 'version' | 'timeout' | 'malformed' | 'rate',
      ) {
        const bearer = await ticket();
        return new Promise<number>((accept, reject) => {
          const socket = new WebSocket(endpoint);
          socket.onopen = () => {
            if (mode === 'timeout') return;
            socket.send(
              JSON.stringify({
                v,
                type: 'hello',
                protocolVersion:
                  mode === 'version' ? protocolVersion + 1 : protocolVersion,
                ticket: bearer,
              }),
            );
          };
          socket.onmessage = (event) => {
            if (JSON.parse(String(event.data)).type !== 'ready') return;
            if (mode === 'malformed') socket.send('not json');
            if (mode === 'rate')
              for (let index = 0; index < 120; index += 1)
                socket.send(
                  JSON.stringify({ v, type: 'ping', id: `burst-${index}` }),
                );
          };
          socket.onclose = (event) => accept(event.code);
          socket.onerror = () =>
            reject(new Error('Native refusal socket unavailable'));
        });
      }
      return {
        version: await closed('version'),
        timeout: await closed('timeout'),
        malformed: await closed('malformed'),
        rate: await closed('rate'),
      };
    },
    { endpoint, v: ENVELOPE_VERSION, protocolVersion: PROTOCOL_VERSION },
  );
}
