import { idSchema, roundAnalysisViewSchema } from '@daisy/protocol';
import { unavailableRead } from '../../server/temporary-read';
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** The caller's own round analysis through its API; missing for anyone who did not debate. */
export async function readRoundAnalysis(fetch: FetchLike, roundId: string) {
  if (!idSchema.safeParse(roundId).success) return { kind: 'missing' as const };
  try {
    const response = await fetch(`/api/rounds/${roundId}/round-analysis`, {
      method: 'GET',
    });
    if ([401, 403, 404].includes(response.status))
      return { kind: 'missing' as const };
    if (!response.ok) return unavailableRead(response);
    const parsed = roundAnalysisViewSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'found' as const, view: parsed.data }
      : { kind: 'unavailable' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}
