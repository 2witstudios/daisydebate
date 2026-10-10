import type { Page } from '@playwright/test';
import { readRealtimeTransportConfig } from '@daisy/config';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol';

/** Actual issued tickets and native sockets; only fixed close codes leave the page. */
export async function nativeRealtimeRefusals(page: Page, endpoint: string) {
  return page.evaluate(
    async ({ endpoint, v, protocolVersion, actorLimit }) => {
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
      async function actorConnections() {
        const sockets: WebSocket[] = [];
        const results: (string | number)[] = [];
        try {
          for (let index = 0; index <= actorLimit; index += 1) {
            const bearer = await ticket();
            const socket = new WebSocket(endpoint);
            sockets.push(socket);
            results.push(
              await new Promise<string | number>((accept, reject) => {
                socket.onopen = () =>
                  socket.send(
                    JSON.stringify({
                      v,
                      type: 'hello',
                      protocolVersion,
                      ticket: bearer,
                    }),
                  );
                socket.onmessage = (event) => {
                  if (JSON.parse(String(event.data)).type === 'ready')
                    accept('ready');
                };
                socket.onclose = (event) => accept(event.code);
                socket.onerror = () =>
                  reject(new Error('Native admission socket unavailable'));
              }),
            );
          }
          return results;
        } finally {
          await Promise.all(
            sockets.map(
              (socket) =>
                new Promise<void>((accept) => {
                  if (socket.readyState === WebSocket.CLOSED) return accept();
                  socket.addEventListener('close', () => accept(), {
                    once: true,
                  });
                  socket.close();
                }),
            ),
          );
        }
      }
      return {
        version: await closed('version'),
        timeout: await closed('timeout'),
        malformed: await closed('malformed'),
        rate: await closed('rate'),
        actorConnections: await actorConnections(),
      };
    },
    {
      endpoint,
      v: ENVELOPE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      actorLimit: readRealtimeTransportConfig(process.env).maxPerActor,
    },
  );
}

export async function nativeTicketReuse(page: Page, endpoint: string) {
  return page.evaluate(
    async ({ v, protocolVersion, endpoint }) => {
      const response = await fetch('/api/realtime/ticket', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status !== 200 ||
        body.socketUrl !== endpoint ||
        typeof body.ticket !== 'string'
      )
        throw new Error('Actual ticket endpoint unavailable');
      const open = () =>
        new Promise<'ready' | number>((accept, reject) => {
          const socket = new WebSocket(body.socketUrl);
          socket.onopen = () =>
            socket.send(
              JSON.stringify({
                v,
                type: 'hello',
                protocolVersion,
                ticket: body.ticket,
              }),
            );
          socket.onmessage = (event) => {
            if (JSON.parse(String(event.data)).type === 'ready') {
              accept('ready');
              socket.close();
            }
          };
          socket.onclose = (event) => accept(event.code);
          socket.onerror = () =>
            reject(new Error('Native ticket socket failed'));
        });
      return [await open(), await open()];
    },
    {
      v: ENVELOPE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      endpoint,
    },
  );
}
