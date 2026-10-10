import { ticketSchema } from '@daisy/protocol';
import { realtimePublicUrlSchema } from '@daisy/config';
import { z } from 'zod';

/**
 * The RT-2.4a route's contract: `POST /api/realtime/ticket` issues a
 * single-use ticket in `@daisy/protocol`'s `ticketSchema` shape (ADR 0031
 * §11). Same-origin, credentials included so the session cookie
 * authenticates the caller. `fetchImpl` is injected: RT-2.4a is being built
 * in parallel, so tests stub the fetch against this contract rather than
 * hitting a real route.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function ticketFailure(
  name:
    | 'RealtimeTicketFetchError'
    | 'RealtimeTicketBodyError'
    | 'RealtimeTicketSchemaObjectError'
    | 'RealtimeTicketSchemaTicketError'
    | 'RealtimeTicketSchemaSocketUrlError'
    | `RealtimeTicketSchemaThrown${'EvalError' | 'ReferenceError' | 'TypeError' | 'UnknownError'}`
    | 'RealtimeTicketEndpointError',
  message: string,
): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function parseTicket(body: unknown) {
  let result;
  try {
    result = z
      .object({ ticket: ticketSchema, socketUrl: realtimePublicUrlSchema })
      .safeParse(body, { jitless: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const fixedClass =
      name === 'EvalError' || name === 'ReferenceError' || name === 'TypeError'
        ? name
        : 'UnknownError';
    throw ticketFailure(
      `RealtimeTicketSchemaThrown${fixedClass}`,
      'realtime ticket response was malformed',
    );
  }
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    throw ticketFailure(
      field === 'ticket'
        ? 'RealtimeTicketSchemaTicketError'
        : field === 'socketUrl'
          ? 'RealtimeTicketSchemaSocketUrlError'
          : 'RealtimeTicketSchemaObjectError',
      'realtime ticket response was malformed',
    );
  }
  return result.data;
}

export async function fetchRealtimeTicket({
  fetchImpl,
  expectedSocketUrl,
}: {
  readonly fetchImpl: FetchLike;
  readonly expectedSocketUrl?: string;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl('/api/realtime/ticket', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    throw ticketFailure(
      'RealtimeTicketFetchError',
      'realtime ticket request failed',
    );
  }
  if (!response.ok) {
    throw ticketFailure(
      'RealtimeTicketFetchError',
      `realtime ticket request failed: ${response.status}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw ticketFailure(
      'RealtimeTicketBodyError',
      'realtime ticket response was malformed',
    );
  }
  const result = parseTicket(body);
  if (expectedSocketUrl !== undefined && result.socketUrl !== expectedSocketUrl)
    throw ticketFailure(
      'RealtimeTicketEndpointError',
      'realtime ticket response was malformed',
    );
  return result.ticket;
}
