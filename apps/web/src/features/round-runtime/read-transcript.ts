import {
  idSchema,
  roundTranscriptReadSchema,
  type RoundTranscriptRead,
} from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** Every result is reauthorized by the same protected read, including native reloads. */
export async function readTranscript(
  fetch: FetchLike,
  roundId: string,
): Promise<ResourceRead<RoundTranscriptRead>> {
  if (!idSchema.safeParse(roundId).success) return { kind: 'missing' };
  try {
    const response = await fetch(`/api/rounds/${roundId}/transcript`, {
      method: 'GET',
    });
    if ([401, 403, 404].includes(response.status)) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = roundTranscriptReadSchema.safeParse(await response.json());
    return parsed.success && parsed.data.round.id === roundId
      ? { kind: 'found', value: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
