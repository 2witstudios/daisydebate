type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The form's answer. An issued link lives in this state alone, and is shown once. */
export type AudienceLinkAnswer =
  | { readonly kind: 'idle' }
  | { readonly kind: 'issued'; readonly url: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' };

/** Posts the host's request to its route, and makes the link absolute to share. */
export async function submitIssue(
  fetch: FetchLike,
  input: { readonly roundId: string; readonly origin: string },
): Promise<AudienceLinkAnswer> {
  try {
    const response = await fetch(
      `/api/rounds/${encodeURIComponent(input.roundId)}/audience-link`,
      { method: 'POST' },
    );
    if (!response.ok)
      return { kind: response.status >= 500 ? 'unavailable' : 'refused' };
    const { href } = (await response.json()) as { readonly href: string };
    return { kind: 'issued', url: new URL(href, input.origin).href };
  } catch {
    return { kind: 'unavailable' };
  }
}
