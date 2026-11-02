import {
  idSchema,
  liveTranscriptReadSchema,
  type LiveTranscriptRead,
} from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** A read an outage leaves hanging must not hold its single-flight sync. */
const READ_DEADLINE_MS = 10_000;
/** Every result is reauthorized by the same protected read, including native reloads. */
export async function readTranscript(
  fetch: FetchLike,
  roundId: string,
  deadline: AbortSignal = AbortSignal.timeout(READ_DEADLINE_MS),
): Promise<ResourceRead<LiveTranscriptRead>> {
  if (!idSchema.safeParse(roundId).success) return { kind: 'missing' };
  try {
    const response = await fetch(`/api/rounds/${roundId}/transcript`, {
      method: 'GET',
      signal: deadline,
    });
    if ([401, 403, 404].includes(response.status)) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = liveTranscriptReadSchema.safeParse(await response.json());
    // The server answered in a shape this build cannot read: only a reload helps.
    if (!parsed.success) return { kind: 'unavailable', outdated: true };
    return parsed.data.round.id === roundId
      ? { kind: 'found', value: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
