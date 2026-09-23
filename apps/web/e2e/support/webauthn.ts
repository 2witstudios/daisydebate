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

/** Resolves on the next passkey sign-in options response. */
export const authenticateOptionsServed = (page: Page) =>
  page.waitForResponse((response) =>
    response.url().includes('/passkey/generate-authenticate-options'),
  );
