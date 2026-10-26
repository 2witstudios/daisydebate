import {
  memberProfileSchema,
  type MatchHistoryQuery,
  type MemberProfile,
} from '@daisy/protocol';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type ProfileRead =
  | { readonly kind: 'found'; readonly profile: MemberProfile }
  | { readonly kind: 'missing' | 'invalid' | 'unavailable' };

/** The canonical profile read, parsed against the contract it promises. */
export async function fetchProfile(
  fetch: FetchLike,
  username: string,
  query: MatchHistoryQuery,
): Promise<ProfileRead> {
  const search = query.before ? `?before=${query.before}` : '';
  try {
    const response = await fetch(
      `/api/profiles/${encodeURIComponent(username)}${search}`,
      { method: 'GET' },
    );
    if (response.status === 404) return { kind: 'missing' };
    if (response.status === 400) return { kind: 'invalid' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = memberProfileSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'found', profile: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
