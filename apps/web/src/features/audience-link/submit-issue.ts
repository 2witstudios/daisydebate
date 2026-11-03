type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The form's answer. An issued link lives in this state alone, and is shown once. */
export type AudienceLinkAnswer =
  | { readonly kind: 'idle' }
  | { readonly kind: 'issued'; readonly url: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' };

/** Posts the host's request to its route, which alone decides and answers the link. */
export async function submitIssue(
  fetch: FetchLike,
  roundId: string,
): Promise<AudienceLinkAnswer> {
  try {
    const response = await fetch(
      `/api/rounds/${encodeURIComponent(roundId)}/audience-link`,
      { method: 'POST' },
    );
    if (!response.ok)
      return { kind: response.status >= 500 ? 'unavailable' : 'refused' };
    const { url } = (await response.json()) as { readonly url: string };
    return { kind: 'issued', url };
  } catch {
    return { kind: 'unavailable' };
  }
}
