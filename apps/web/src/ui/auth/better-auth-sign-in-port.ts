import { onboardingHref } from '../../features/access/decision';
import type {
  LinkRequestOutcome,
  PasskeyAutofillOutcome,
  PasskeyOutcome,
  SignInPort,
} from './sign-in-port';

type ClientError = {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
} | null;

/**
 * The slice of the Better Auth client this adapter uses. Structural, so the
 * adapter is testable without a network and never sees transport types.
 */
export type SignInClient = {
  readonly signIn: {
    readonly magicLink: (input: {
      email: string;
      callbackURL: string;
      newUserCallbackURL: string;
    }) => Promise<{ readonly error: ClientError }>;
    readonly passkey: (opts?: {
      autoFill?: boolean;
    }) => Promise<{ readonly error: ClientError }>;
  };
};

const linkOutcome = (error: ClientError): LinkRequestOutcome => {
  if (error === null) return { kind: 'sent' };
  if (error.code === 'EMAIL_UNDELIVERABLE') return { kind: 'undeliverable' };
  if (error.status === 429) return { kind: 'rate-limited' };
  return { kind: 'unavailable' };
};

/**
 * The browser reports every dismissed prompt, timeout and missing credential
 * as one indistinguishable "not allowed" failure, so those are `cancelled`.
 */
const CANCELLED_CODES = new Set([
  'AUTH_CANCELLED',
  'ERROR_CEREMONY_ABORTED',
  'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
]);

const passkeyOutcome = (error: ClientError): PasskeyOutcome => {
  if (error === null) return { kind: 'signed-in' };
  return error.code !== undefined && CANCELLED_CODES.has(error.code)
    ? { kind: 'cancelled' }
    : { kind: 'failed' };
};

/** SimpleWebAuthn's code when a newer ceremony aborted this one. */
const ABORTED = 'ERROR_CEREMONY_ABORTED';

/**
 * An autofill request settles only after a pick or an abort, so a 4xx other
 * than throttling means the server refused the chosen passkey (an expired
 * challenge, a credential it no longer holds); anything else is transient.
 */
const autofillOutcome = (error: ClientError): PasskeyAutofillOutcome => {
  if (error === null) return { kind: 'signed-in' };
  if (error.code === ABORTED) return { kind: 'superseded' };
  if (error.code !== undefined && CANCELLED_CODES.has(error.code))
    return { kind: 'interrupted' };
  const status = error.status ?? 0;
  return status >= 400 && status < 500 && status !== 429
    ? { kind: 'refused' }
    : { kind: 'interrupted' };
};

/**
 * Better Auth behind the sign-in screens: client results become the four
 * honest outcomes each screen can show. `destination` is already validated;
 * a new account is routed through username onboarding on the way to it.
 */
export function createBetterAuthSignInPort({
  client,
  destination,
  supportsPasskeys,
  supportsPasskeyAutofill,
}: {
  readonly client: SignInClient;
  readonly destination: string;
  readonly supportsPasskeys: () => boolean;
  /** Whether the browser can list passkeys in autofill (conditional UI). */
  readonly supportsPasskeyAutofill: () => Promise<boolean>;
}): SignInPort {
  // An autofill request still fetching its options when the button starts
  // reaches the browser later and aborts the button's prompt (SimpleWebAuthn
  // keeps one ceremony at a time). Counting them lets the button tell that
  // abort apart and retry once, which then aborts the autofill instead.
  let autofillsInFlight = 0;
  return {
    requestLink: async (email) =>
      linkOutcome(
        (
          await client.signIn.magicLink({
            email,
            callbackURL: destination,
            newUserCallbackURL: onboardingHref(destination),
          })
        ).error,
      ),
    signInWithPasskey: async () => {
      if (!supportsPasskeys()) return { kind: 'unsupported' };
      const raced = autofillsInFlight > 0;
      const { error } = await client.signIn.passkey();
      return passkeyOutcome(
        raced && error?.code === ABORTED
          ? (await client.signIn.passkey()).error
          : error,
      );
    },
    offerPasskeyAutofill: async () => {
      autofillsInFlight += 1;
      try {
        return (await supportsPasskeyAutofill())
          ? autofillOutcome(
              (await client.signIn.passkey({ autoFill: true })).error,
            )
          : { kind: 'unavailable' };
      } finally {
        autofillsInFlight -= 1;
      }
    },
  };
}
