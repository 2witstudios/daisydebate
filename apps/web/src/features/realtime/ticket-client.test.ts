import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fetchRealtimeTicket } from './ticket-client';

setupRitewayBun();

const validTicket = 'a'.repeat(43);

describe('fetchRealtimeTicket (RT-2.4a contract: POST /api/realtime/ticket)', () => {
  test('POSTs same-origin and returns the ticket from a well-formed response', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          ticket: validTicket,
          socketUrl: 'wss://socket.daisy.invalid/realtime',
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const ticket = await fetchRealtimeTicket({ fetchImpl });

    assert({
      given: 'a stubbed fetch answering 201 with a well-formed ticket',
      should: 'POST /api/realtime/ticket and resolve the ticket string',
      actual: { ticket, method: calls[0]?.init?.method, url: calls[0]?.url },
      expected: {
        ticket: validTicket,
        method: 'POST',
        url: '/api/realtime/ticket',
      },
    });
  });

  test('rejects a non-ok response without exposing the body', async () => {
    const fetchImpl = async () =>
      new Response('internal detail', { status: 500 });

    await expect(fetchRealtimeTicket({ fetchImpl })).rejects.toThrow(
      'realtime ticket request failed',
    );
  });

  test('rejects a response whose shape does not match a ticket', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ticket: 'too-short' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });

    await expect(fetchRealtimeTicket({ fetchImpl })).rejects.toThrow(
      'realtime ticket response was malformed',
    );
  });
});

test('ticket endpoint binding refuses an endpoint different from the configured browser transport', async () => {
  await expect(
    fetchRealtimeTicket({
      expectedSocketUrl: 'wss://socket.daisy.invalid/realtime',
      fetchImpl: async () =>
        Response.json({
          ticket: validTicket,
          socketUrl: 'wss://foreign.invalid/',
        }),
    }),
  ).rejects.toThrow('realtime ticket response was malformed');
});

test('configured native ticket response validates exact WSS binding with production TTL metadata', async () => {
  const endpoint = 'wss://localhost:13014/ws';
  assert({
    given: 'the actual configured native endpoint and production response keys',
    should:
      'return only the validated ticket while preserving exact endpoint binding',
    actual: await fetchRealtimeTicket({
      expectedSocketUrl: endpoint,
      fetchImpl: async () =>
        Response.json({
          ticket: validTicket,
          socketUrl: endpoint,
          expiresInSeconds: 30,
        }),
    }),
    expected: validTicket,
  });
});

test('reader failures expose only fixed stage names and never untrusted diagnostics', async () => {
  const cases: ReadonlyArray<{
    name: string;
    fetchImpl: () => Promise<Response>;
    endpoint?: string;
  }> = [
    {
      name: 'RealtimeTicketFetchError',
      fetchImpl: async () => {
        throw new Error('private transport detail');
      },
    },
    {
      name: 'RealtimeTicketFetchError',
      fetchImpl: async () => new Response('private body', { status: 503 }),
    },
    {
      name: 'RealtimeTicketBodyError',
      fetchImpl: async () => new Response('private invalid JSON'),
    },
    {
      name: 'RealtimeTicketSchemaTicketError',
      fetchImpl: async () =>
        Response.json({ ticket: 'private malformed ticket' }),
    },
    {
      name: 'RealtimeTicketSchemaObjectError',
      fetchImpl: async () => Response.json(null),
    },
    {
      name: 'RealtimeTicketSchemaSocketUrlError',
      fetchImpl: async () =>
        Response.json({
          ticket: validTicket,
          socketUrl: 'https://private.invalid',
        }),
    },
    {
      name: 'RealtimeTicketEndpointError',
      endpoint: 'wss://expected.invalid/ws',
      fetchImpl: async () =>
        Response.json({
          ticket: validTicket,
          socketUrl: 'wss://foreign.invalid/ws',
        }),
    },
  ];
  for (const scenario of cases) {
    let actual: unknown;
    try {
      await fetchRealtimeTicket({
        fetchImpl: scenario.fetchImpl,
        ...(scenario.endpoint ? { expectedSocketUrl: scenario.endpoint } : {}),
      });
    } catch (error) {
      actual =
        error instanceof Error
          ? {
              name: error.name,
              privateDetail: error.message.includes('private'),
            }
          : error;
    }
    assert({
      given: scenario.name,
      should: 'report its fixed stage without response or transport details',
      actual,
      expected: { name: scenario.name, privateDetail: false },
    });
  }
});

test('thrown schema exceptions retain only a fixed native class', async () => {
  for (const failure of [
    new EvalError('private eval detail'),
    new ReferenceError('private reference'),
    new TypeError('private type'),
    new Error('private unknown'),
  ]) {
    const payload = Object.defineProperty(
      { socketUrl: 'wss://localhost:13014/ws' },
      'ticket',
      {
        get() {
          throw failure;
        },
        enumerable: true,
      },
    );
    let actual: unknown;
    try {
      await fetchRealtimeTicket({
        fetchImpl: async () =>
          Object.assign(Response.json({}), { json: async () => payload }),
      });
    } catch (error) {
      actual =
        error instanceof Error
          ? [error.name, error.message.includes('private')]
          : error;
    }
    assert({
      given: 'a parser exception with private diagnostic text',
      should:
        'distinguish it from rejected schema fields without retaining detail',
      actual,
      expected: [
        `RealtimeTicketSchemaThrown${failure.name === 'Error' ? 'UnknownError' : failure.name}`,
        false,
      ],
    });
  }
});
