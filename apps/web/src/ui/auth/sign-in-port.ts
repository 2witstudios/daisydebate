/**
 * Outcome of asking for a magic link. It never says whether an account
 * exists: "sent" means the request was accepted, not that mail arrived.
 */
export type LinkRequestOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'undeliverable' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable' };

/** Outcome of a passkey sign-in ceremony. Only `signed-in` is a success. */
export type PasskeyOutcome =
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed' };

/**
 * The seam between the sign-in screens and whatever authenticates. The mock
 * implements it today; a Better Auth adapter replaces it by mapping client
 * results onto these outcomes, so the screens never see transport errors.
 */
export type SignInPort = {
  readonly requestLink: (email: string) => Promise<LinkRequestOutcome>;
  readonly signInWithPasskey: () => Promise<PasskeyOutcome>;
};

/** A port that throws is treated as unavailable: the screen never hangs. */
export const requestLinkSafely = (
  port: SignInPort,
  email: string,
): Promise<LinkRequestOutcome> =>
  port
    .requestLink(email)
    .catch((): LinkRequestOutcome => ({ kind: 'unavailable' }));

/** A ceremony that throws is a failure, never a false success. */
export const signInWithPasskeySafely = (
  port: SignInPort,
): Promise<PasskeyOutcome> =>
  port.signInWithPasskey().catch((): PasskeyOutcome => ({ kind: 'failed' }));
