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
      /** Better Auth applies these only to the verify request. */
      fetchOptions?: { onRequest?: () => void };
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
 * Whether the person picked a passkey is known for certain: the verify
 * request only follows a pick. A failure after it is the server refusing
 * that passkey (an expired challenge, a credential it no longer holds, an
 * outage), which the person must hear about; a failure before it is a
 * dismissal or an options fault, which is retried quietly.
 */
const autofillOutcome = (
  error: ClientError,
  picked: boolean,
): PasskeyAutofillOutcome => {
  if (error === null) return { kind: 'signed-in' };
  if (error.code === ABORTED) return { kind: 'superseded' };
  return picked ? { kind: 'refused' } : { kind: 'interrupted' };
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
        if (!(await supportsPasskeyAutofill())) return { kind: 'unavailable' };
        let picked = false;
        const { error } = await client.signIn.passkey({
          autoFill: true,
          fetchOptions: {
            onRequest: () => {
              picked = true;
            },
          },
        });
        return autofillOutcome(error, picked);
      } finally {
        autofillsInFlight -= 1;
      }
    },
  };
}
