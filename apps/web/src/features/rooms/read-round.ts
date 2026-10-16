import { idSchema, roundViewSchema, type RoundView } from '@daisy/protocol';
import { realtimeEndpointOf } from '../realtime/endpoint-header';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Read =
  | {
      readonly kind: 'found';
      readonly round: RoundView;
      /** Where the round's doorbell rings, when realtime is configured. */
      readonly socketUrl: string | null;
    }
  | { readonly kind: 'missing' | 'unavailable' };

/** What a round read must answer for a consumer that needs only the round. */
export type RoundRead =
  | { readonly kind: 'found'; readonly round: RoundView }
  | { readonly kind: 'missing' | 'unavailable' };

export async function readRoundReceipt(
  fetch: FetchLike,
  id: string,
): Promise<Read> {
  if (!idSchema.safeParse(id).success) return { kind: 'missing' };
  try {
    const response = await fetch(`/api/rounds/${id}`, { method: 'GET' });
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = roundViewSchema.safeParse(await response.json());
    return parsed.success && parsed.data.id === id
      ? {
          kind: 'found',
          round: parsed.data,
          socketUrl: realtimeEndpointOf(response),
        }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
