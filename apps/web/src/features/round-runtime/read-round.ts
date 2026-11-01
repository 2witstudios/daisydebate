import { idSchema, roundViewSchema, type RoundView } from '@daisy/protocol';
import { realtimeEndpointOf } from '../realtime/endpoint-header';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** What a round read must answer for a consumer that needs only the round. */
export type RoundRead =
  | {
      readonly kind: 'found';
      readonly round: RoundView;
      /**
       * The explicit millisecond server instant the authorized read itself
       * generated, from the round server's own clock — never the HTTP Date's
       * seconds. The client's lifetime owner brackets the request on its own
       * monotonic clock; this instant is what it calibrates against.
       */
      readonly serverNowMs: number | null;
      /** Where the round's doorbell rings, when realtime is configured. */
      readonly socketUrl: string | null;
    }
  | {
      readonly kind: 'missing' | 'unavailable';
      readonly socketUrl: string | null;
    };

export async function readRoundReceipt(
  fetch: FetchLike,
  id: string,
): Promise<RoundRead> {
  if (!idSchema.safeParse(id).success)
    return { kind: 'missing', socketUrl: null };
  try {
    const response = await fetch(`/api/rounds/${id}`, { method: 'GET' });
    if (response.status === 404) return { kind: 'missing', socketUrl: null };
    if (!response.ok) return { kind: 'unavailable', socketUrl: null };
    const parsed = roundViewSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.id !== id)
      return { kind: 'unavailable', socketUrl: null };
    const header = response.headers.get('x-server-now-ms');
    const serverNowMs = header === null ? null : Number(header);
    return {
      kind: 'found',
      round: parsed.data,
      serverNowMs:
        serverNowMs !== null && Number.isFinite(serverNowMs)
          ? serverNowMs
          : null,
      socketUrl: realtimeEndpointOf(response),
    };
  } catch {
    return { kind: 'unavailable', socketUrl: null };
  }
}
