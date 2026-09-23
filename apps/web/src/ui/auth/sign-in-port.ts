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
  /**
   * Offers stored passkeys in the browser's own autofill on the email field
   * (conditional mediation). It settles only when one is picked, or when a
   * later ceremony aborts it.
   */
  readonly offerPasskeyAutofill: () => Promise<PasskeyOutcome>;
};

// Both helpers call the port inside `try`: an adapter can throw before it
// returns a promise (client init, argument validation), and a `.catch()` on
// the result would never see that, leaving the screen pending forever.

/** A port that throws is treated as unavailable: the screen never hangs. */
export const requestLinkSafely = async (
  port: SignInPort,
  email: string,
): Promise<LinkRequestOutcome> => {
  try {
    return await port.requestLink(email);
  } catch {
    return { kind: 'unavailable' };
  }
};

/** A ceremony that throws is a failure, never a false success. */
const passkeySafely = async (
  ceremony: () => Promise<PasskeyOutcome>,
): Promise<PasskeyOutcome> => {
  try {
    return await ceremony();
  } catch {
    return { kind: 'failed' };
  }
};

export const signInWithPasskeySafely = (
  port: SignInPort,
): Promise<PasskeyOutcome> => passkeySafely(() => port.signInWithPasskey());

export const offerPasskeyAutofillSafely = (
  port: SignInPort,
): Promise<PasskeyOutcome> => passkeySafely(() => port.offerPasskeyAutofill());
