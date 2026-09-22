import type {
  LinkRequestOutcome,
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
    readonly passkey: () => Promise<{ readonly error: ClientError }>;
  };
};

/** Where a first-time account chooses a username, then continues on. */
export const onboardingDestination = (destination: string): string =>
  `/onboarding/username?next=${encodeURIComponent(destination)}`;

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

/**
 * Better Auth behind the sign-in screens: client results become the four
 * honest outcomes each screen can show. `destination` is already validated;
 * a new account is routed through username onboarding on the way to it.
 */
export function createBetterAuthSignInPort({
  client,
  destination,
  supportsPasskeys,
}: {
  readonly client: SignInClient;
  readonly destination: string;
  readonly supportsPasskeys: () => boolean;
}): SignInPort {
  return {
    requestLink: async (email) =>
      linkOutcome(
        (
          await client.signIn.magicLink({
            email,
            callbackURL: destination,
            newUserCallbackURL: onboardingDestination(destination),
          })
        ).error,
      ),
    signInWithPasskey: async () =>
      supportsPasskeys()
        ? passkeyOutcome((await client.signIn.passkey()).error)
        : { kind: 'unsupported' },
  };
}
