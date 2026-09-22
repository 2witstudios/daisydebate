/** What claiming a username can end in. Only `claimed` is a success. */
export type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly username: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'taken' }
  | { readonly kind: 'already-set' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable' };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ClaimUsername = (username: string) => Promise<ClaimOutcome>;

const errorCode = async (response: Response): Promise<string | undefined> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The claim over POST /api/account/username. The body is exactly
 * `{ username }`: the server decides who is asking from the session cookie.
 * A 200 is the owner's idempotent retry and counts as claimed.
 */
export const createClaimUsername =
  (fetchImpl: FetchLike): ClaimUsername =>
  async (username) => {
    let response: Response;
    try {
      response = await fetchImpl('/api/account/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      });
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 200 || response.status === 201) {
      try {
        const body = (await response.json()) as { username?: unknown };
        return typeof body.username === 'string'
          ? { kind: 'claimed', username: body.username }
          : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    }
    if (response.status === 400) return { kind: 'invalid' };
    if (response.status === 401) return { kind: 'signed-out' };
    if (response.status === 429) return { kind: 'rate-limited' };
    if (response.status === 409)
      return (await errorCode(response)) === 'USERNAME_TAKEN'
        ? { kind: 'taken' }
        : { kind: 'already-set' };
    return { kind: 'unavailable' };
  };
