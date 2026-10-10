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

export async function fetchRealtimeTicket({
  fetchImpl,
  expectedSocketUrl,
}: {
  readonly fetchImpl: FetchLike;
  readonly expectedSocketUrl?: string;
}): Promise<string> {
  const response = await fetchImpl('/api/realtime/ticket', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`realtime ticket request failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  const result = z
    .object({ ticket: ticketSchema, socketUrl: realtimePublicUrlSchema })
    .safeParse(body);
  if (
    !result.success ||
    (expectedSocketUrl !== undefined &&
      result.data.socketUrl !== expectedSocketUrl)
  )
    throw new Error('realtime ticket response was malformed');
  return result.data.ticket;
}
