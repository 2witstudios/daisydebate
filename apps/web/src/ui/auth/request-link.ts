import { onboardingHref } from '../../features/access/decision';
import type { LinkRequestOutcome } from './sign-in-port';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type RequestLink = (email: string) => Promise<LinkRequestOutcome>;

/**
 * What the sign-in form shows after a post: the address as typed, and how
 * the request ended with the time it was answered (UTC ISO), which starts
 * the resend cooldown.
 */
export type LinkFormState = {
  readonly email: string;
  readonly answer?: {
    readonly outcome: LinkRequestOutcome;
    readonly at: string;
  };
};

export const initialLinkForm: LinkFormState = { email: '' };

const UNAVAILABLE: LinkRequestOutcome = { kind: 'unavailable' };

const errorCode = async (response: Response): Promise<unknown> => {
  try {
    return ((await response.json()) as { code?: unknown }).code;
  } catch {
    return undefined;
  }
};

const refusal = async (response: Response): Promise<LinkRequestOutcome> => {
  if (response.status === 429) return { kind: 'rate-limited' };
  return (await errorCode(response)) === 'EMAIL_UNDELIVERABLE'
    ? { kind: 'undeliverable' }
    : UNAVAILABLE;
};

/**
 * A link request over POST /api/auth/sign-in/magic-link, landing on the
 * already validated `destination`, with a new account routed through
 * username onboarding on the way. It never says whether an account exists.
 */
export const createRequestLink =
  (fetchImpl: FetchLike, destination: string): RequestLink =>
  async (email) => {
    let response: Response;
    try {
      response = await fetchImpl('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          callbackURL: destination,
          newUserCallbackURL: onboardingHref(destination),
        }),
      });
    } catch {
      return UNAVAILABLE;
    }
    return response.ok ? { kind: 'sent' } : refusal(response);
  };

/**
 * One posted sign-in form. The form is untrusted: a missing or non-text
 * field is an empty address, which the route refuses. A request that throws
 * is unavailable, never sent.
 */
export async function submitLinkRequest(
  requestLink: RequestLink,
  form: FormData,
  at: string,
): Promise<LinkFormState> {
  const field = form.get('email');
  const email = typeof field === 'string' ? field.trim() : '';
  let outcome: LinkRequestOutcome;
  try {
    outcome = await requestLink(email);
  } catch {
    outcome = UNAVAILABLE;
  }
  return { email, answer: { outcome, at } };
}
