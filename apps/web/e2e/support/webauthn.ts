import type { CDPSession, Page } from '@playwright/test';

const readCredentials = async (session: CDPSession, authenticatorId: string) =>
  (await session.send('WebAuthn.getCredentials', { authenticatorId }))
    .credentials;
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
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  for (const credential of preloaded)
    await session.send('WebAuthn.addCredential', {
      authenticatorId,
      credential,
    });
  const setPresence = (enabled: boolean) =>
    session.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId,
      enabled,
    });
  const credentials = () => readCredentials(session, authenticatorId);
  return { session, authenticatorId, setPresence, credentials };
}

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
