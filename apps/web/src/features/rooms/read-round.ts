import { idSchema, roundViewSchema, type RoundView } from '@daisy/protocol';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Read =
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
      ? { kind: 'found', round: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
