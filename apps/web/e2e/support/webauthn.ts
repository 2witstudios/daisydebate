import { expect, type CDPSession, type Page } from '@playwright/test';
import { boundedStep } from './bounded-step';
import { hydrated } from './hydration';

// Every CDP command below is a bounded step: Playwright gives CDP no timeout
// of its own, so a hung authenticator call would otherwise surface only as
// the test's 30 s timeout, naming nothing (ISSUE-212).
const readCredentials = async (session: CDPSession, authenticatorId: string) =>
  (
    await boundedStep('CDP WebAuthn.getCredentials', () =>
      session.send('WebAuthn.getCredentials', { authenticatorId }),
    )
  ).credentials;
type Credentials = Awaited<ReturnType<typeof readCredentials>>;

/**
 * A Chromium virtual WebAuthn authenticator (CDP
 * `WebAuthn.addVirtualAuthenticator`): a discoverable, user-verifying
 * platform credential store that answers real `navigator.credentials`
 * ceremonies. It can start with credentials exported from another device
 * (`credentials()`), and `setPresence` holds or releases user presence.
 */
export async function addVirtualAuthenticator(
  page: Page,
  preloaded: Credentials = [],
) {
  const session = await boundedStep('CDP session for WebAuthn', () =>
    page.context().newCDPSession(page),
  );
  await boundedStep('CDP WebAuthn.enable', () =>
    session.send('WebAuthn.enable'),
  );
  const { authenticatorId } = await boundedStep(
    'CDP WebAuthn.addVirtualAuthenticator',
    () =>
      session.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      }),
  );
  for (const credential of preloaded)
    await boundedStep('CDP WebAuthn.addCredential', () =>
      session.send('WebAuthn.addCredential', { authenticatorId, credential }),
    );
  const setPresence = (enabled: boolean) =>
    boundedStep('CDP WebAuthn.setAutomaticPresenceSimulation', () =>
      session.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId,
        enabled,
      }),
    );
  const remove = () =>
    boundedStep('CDP WebAuthn.removeVirtualAuthenticator', () =>
      session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }),
    );
  const credentials = () => readCredentials(session, authenticatorId);
  return { session, authenticatorId, setPresence, credentials, remove };
}

/**
 * Accepts the passkey offer right after onboarding, waiting for the real
 * ceremony's own response before the full-page navigation that follows a
 * successful save, so a slow verify never races the client's in-flight
 * request.
 */
export async function savePasskeyOffer(page: Page) {
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/passkey/verify-registration'),
    ),
    page.getByRole('button', { name: 'Save a passkey on this device' }).click(),
  ]);
}

/**
 * Clicks a script button that starts a passkey ceremony and waits for that
 * ceremony's own verify answer. Hardening, not a proven fix (ISSUE-212):
 * hydration first, because a click before React wires the handler is a
 * silent no-op (ISSUE-84), then the server's answer, bounded, so a ceremony
 * that never reaches the server fails naming the endpoint it never called.
 */
async function ceremony(
  page: Page,
  button: string,
  endpoint: 'verify-registration' | 'verify-authentication',
) {
  const control = page.getByRole('button', { name: button });
  await hydrated(control);
  const [answer] = await Promise.all([
    boundedStep(`the ${endpoint} answer after "${button}"`, () =>
      page.waitForResponse(
        (response) => response.url().includes(`/passkey/${endpoint}`),
        { timeout: 0 },
      ),
    ),
    control.click(),
  ]);
  expect(answer.ok(), `${endpoint} answered ${answer.status()}`).toBe(true);
}

/** Enrolls a passkey from account security settings on the page's device. */
export const enrollFromSettings = (page: Page) =>
  ceremony(page, 'Add a passkey', 'verify-registration');

/** Takes the sign-in page's explicit passkey button through to the server. */
export const signInWithPasskey = (page: Page) =>
  ceremony(page, 'Sign in with a passkey', 'verify-authentication');

/**
 * The sign-in page also arms passkey autofill (conditional mediation), and
 * Chromium's virtual authenticator completes that request with no pick at
 * all, racing the explicit button. Specs that prove the button path hide
 * conditional mediation so the button is the only way in.
 */
export async function withoutPasskeyAutofill(page: Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(
      PublicKeyCredential,
      'isConditionalMediationAvailable',
    );
  });
}

/**
 * Playwright's Linux WebKit (the CI image) is built without WebAuthn:
 * `PublicKeyCredential` is a plain object, not a constructor, and
 * `navigator.credentials` is missing, so the sign-in page rightly answers
 * "cannot use passkeys" before any request. macOS WebKit, Chromium and
 * Firefox expose both. A spec about what follows the ceremony's server
 * exchange declares the capability where the engine lacks it, so every
 * engine reaches that exchange; an engine that has it is left untouched.
 */
export async function withPasskeyCapability(page: Page) {
  await page.addInitScript(() => {
    if (typeof window.PublicKeyCredential === 'function') return;
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: function PublicKeyCredential() {},
    });
  });
}
