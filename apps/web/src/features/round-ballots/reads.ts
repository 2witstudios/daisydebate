import {
  idSchema,
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
} from '@daisy/protocol';
import type { ServerRoundSample } from '../round-runtime/read-round';
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** Canonical protected input/result read; query parameters never choose a ballot state. */
export async function readRoundBallot(fetch: FetchLike, roundId: string) {
  if (!idSchema.safeParse(roundId).success) return { kind: 'missing' as const };
  try {
    const sentAtMs = performance.now();
    const response = await fetch(`/api/rounds/${roundId}/ballots`, {
      method: 'GET',
    });
    const receivedAtMs = performance.now();
    if (response.status === 404) return { kind: 'missing' as const };
    if (!response.ok) return { kind: 'unavailable' as const };
    const parsed = roundBallotReadSchema.safeParse(await response.json());
    const header = response.headers.get('x-server-now-ms');
    const serverNowMs = header === null ? null : Number(header);
    const serverSample: ServerRoundSample | null =
      serverNowMs !== null && Number.isFinite(serverNowMs)
        ? { serverNowMs, sentAtMs, receivedAtMs }
        : null;
    return parsed.success && parsed.data.round.id === roundId
      ? { kind: 'found' as const, view: parsed.data, serverSample }
      : { kind: 'unavailable' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}
export async function readJudgeAssignments(fetch: FetchLike) {
  try {
    const response = await fetch('/api/judge/assignments', { method: 'GET' });
    if (!response.ok) return { kind: 'unavailable' as const };
    const parsed = roundJudgeAssignmentsSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'found' as const, assignments: parsed.data }
      : { kind: 'unavailable' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}
