import { realtimePublicUrlSchema } from '@daisy/config';

/**
 * The realtime endpoint a same-origin read names in `x-realtime-socket-url`,
 * or null when it names none or one that is not a realtime endpoint.
 */
export function realtimeEndpointOf(response: Response): string | null {
  const parsed = realtimePublicUrlSchema.safeParse(
    response.headers.get('x-realtime-socket-url'),
  );
  return parsed.success ? parsed.data : null;
}
