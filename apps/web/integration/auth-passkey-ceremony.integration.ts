import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { identityUserId } from './auth-account-helpers';
import { createPasskeyFlows, rpID } from './auth-passkey-flows';
import { cookieHeader, counts, origin } from './fixtures';
import {
  buildAuthenticationResponse,
  buildRegistrationResponse,
  createSoftwareCredential,
} from './webauthn-authenticator';
import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { recordedEvents } = flows;
const { signUp } = flows.account;

describe('AUTH-5.1 passkey enrollment', () => {
  test('a fresh verified session completes a real registration and persists only public credential data', async () => {
    const { email, cookie } = await signUp();
    const { verifyResponse } = await flows.enrollPasskey(cookie, {
      name: 'Laptop',
    });
    const body = (await verifyResponse.json()) as {
      id: string;
      name: string;
      publicKey: string;
    };
    assert({
      given: 'a freshly signed-in account completing a real WebAuthn ceremony',
      should:
        'return 200 with the stored passkey and persist exactly one credential',
      actual: {
        status: verifyResponse.status,
        name: body.name,
        hasPublicKey:
          typeof body.publicKey === 'string' && body.publicKey.length > 0,
        stored: (await counts(email)).passkeys,
      },
      expected: { status: 200, name: 'Laptop', hasPublicKey: true, stored: 1 },
    });
  });

  test('additional passkeys can be added to an account that already has one', async () => {
    const { email, cookie } = await signUp();
    await flows.enrollPasskey(cookie, { name: 'Laptop' });
    const second = await flows.enrollPasskey(cookie, { name: 'Phone' });
    assert({
      given: 'a second registration ceremony for the same account',
      should: 'succeed and leave both credentials stored',
      actual: {
        status: second.verifyResponse.status,
        stored: (await counts(email)).passkeys,
      },
      expected: { status: 200, stored: 2 },
    });
  });

  test('registration options prefer the device without excluding roaming keys', async () => {
    const { cookie } = await signUp();
    const optionsResponse = await flows.get(
      '/api/auth/passkey/generate-register-options',
      cookie,
    );
    const options = (await optionsResponse.json()) as {
      hints?: unknown;
      authenticatorSelection?: Record<string, unknown>;
    };
    assert({
      given: 'a signed-in registration-options request',
      should:
        'hint the device authenticator first, require a discoverable credential, and leave the attachment open',
      actual: {
        hints: options.hints,
        attachment: options.authenticatorSelection?.['authenticatorAttachment'],
        residentKey: options.authenticatorSelection?.['residentKey'],
      },
      expected: {
        hints: ['client-device'],
        attachment: undefined,
        residentKey: 'required',
      },
    });
  });

  test('registering without a session is rejected and stores no credential', async () => {
    const { email } = await signUp();
    const optionsResponse = await flows.get(
      '/api/auth/passkey/generate-register-options',
    );
    assert({
      given: 'no session cookie on the registration-options request',
      should: 'reject before a challenge is ever issued, and store nothing',
      actual: {
        status: optionsResponse.status,
        stored: (await counts(email)).passkeys,
      },
      expected: { status: 401, stored: 0 },
    });
  });

  test('a wrong origin in the ceremony response is rejected and stores no credential', async () => {
    const { email, cookie } = await signUp();
    const { verifyResponse } = await flows.enrollPasskey(cookie, {
      badOrigin: 'https://attacker.example',
    });
    assert({
      given: 'a registration response whose clientData names a foreign origin',
      should: 'be rejected and leave no credential behind',
      actual: { ok: verifyResponse.ok, stored: (await counts(email)).passkeys },
      expected: { ok: false, stored: 0 },
    });
  });

  test('a completed registration emits the enrolled lifecycle event (AUTH-6.4)', async () => {
    const { cookie } = await signUp();
    const events = await recordedEvents(async () => {
      await flows.enrollPasskey(cookie, { name: 'Laptop' });
    });
    assert({
      given: 'a real passkey registration ceremony that succeeds',
      should: 'emit auth.passkey.enrolled',
      actual: events.filter((event) => event.startsWith('auth.passkey.')),
      expected: ['auth.passkey.enrolled'],
    });
  });

  test('a duplicate credential id is rejected and does not touch the existing row', async () => {
    const { email, cookie } = await signUp();
    const first = await flows.enrollPasskey(cookie, { name: 'Laptop' });
    // Replaying the exact same attestation (same credential id) a second
    // time hits the database's unique index; the duplicate must be refused.
    const optionsResponse = await flows.get(
      '/api/auth/passkey/generate-register-options',
      cookie,
    );
    const options = (await optionsResponse.json()) as { challenge: string };
    const replay = buildRegistrationResponse({
      credential: first.credential,
      challenge: options.challenge,
      origin,
      rpID,
    });
    const duplicate = await flows.post(
      '/api/auth/passkey/verify-registration',
      { response: replay },
      [
        cookie,
        optionsResponse.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; '),
      ]
        .filter(Boolean)
        .join('; '),
    );
    assert({
      given: "a second registration replaying the first credential's id",
      should: 'be rejected and leave exactly the original credential stored',
      actual: { ok: duplicate.ok, stored: (await counts(email)).passkeys },
      expected: { ok: false, stored: 1 },
    });
  });
});

describe('AUTH-5.2 passkey sign-in', () => {
  test('an enrolled authenticator completes the assertion and establishes a session', async () => {
    const { cookie } = await signUp();
    const { credential } = await flows.enrollPasskey(cookie);
    const { verifyResponse } = await flows.signInWithPasskey(credential);
    const body = (await verifyResponse.json()) as { user?: { id: string } };
    const session = await flows.account.sessionAs(cookieHeader(verifyResponse));
    assert({
      given: 'a real assertion from the credential just enrolled',
      should: 'answer 200 and establish a session for the credential owner',
      actual: {
        status: verifyResponse.status,
        signedIn: typeof body.user?.id === 'string',
        sessionUserId: identityUserId(session.identity),
      },
      expected: { status: 200, signedIn: true, sessionUserId: body.user?.id },
    });
  });

  test('a malformed assertion creates no session', async () => {
    const optionsResponse = await flows.get(
      '/api/auth/passkey/generate-authenticate-options',
    );
    const malformed = await flows.post(
      '/api/auth/passkey/verify-authentication',
      { response: { id: 'not-a-real-credential', rawId: 'x', response: {} } },
      optionsResponse.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    );
    const session = await flows.account.sessionAs(cookieHeader(malformed));
    assert({
      given: 'a structurally invalid assertion for an unknown credential',
      should: 'be rejected without a session',
      actual: {
        ok: malformed.ok,
        sessionUserId: identityUserId(session.identity),
      },
      expected: { ok: false, sessionUserId: null },
    });
  });

  test('a replayed assertion (stale counter) is rejected on the second use', async () => {
    const { cookie } = await signUp();
    const { credential } = await flows.enrollPasskey(cookie);
    const optionsResponse = await flows.get(
      '/api/auth/passkey/generate-authenticate-options',
    );
    const options = (await optionsResponse.json()) as { challenge: string };
    const assertion = await buildAuthenticationResponse({
      credential,
      challenge: options.challenge,
      origin,
      rpID,
    });
    const challengeCookie = optionsResponse.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const firstUse = await flows.post(
      '/api/auth/passkey/verify-authentication',
      { response: assertion },
      challengeCookie,
    );
    // The single-use challenge cookie/token is already consumed; replaying
    // the exact same assertion must fail on the second attempt.
    const replay = await flows.post(
      '/api/auth/passkey/verify-authentication',
      { response: assertion },
      challengeCookie,
    );
    // A fresh assertion over the same challenge has a higher counter than
    // `assertion`, so a stale-counter check alone would let it through.
    // Submitting it against the already-consumed challenge cookie proves
    // the rejection comes from consumed challenge state, not a stale
    // counter on the reused `assertion` value above.
    const freshAssertion = await buildAuthenticationResponse({
      credential,
      challenge: options.challenge,
      origin,
      rpID,
    });
    const replayWithFreshCounter = await flows.post(
      '/api/auth/passkey/verify-authentication',
      { response: freshAssertion },
      challengeCookie,
    );
    assert({
      given: 'the exact same assertion submitted a second time',
      should: 'succeed once and be rejected on replay',
      actual: { first: firstUse.ok, replay: replay.ok },
      expected: { first: true, replay: false },
    });
    assert({
      given:
        'a newly signed assertion over the same challenge, submitted with the already-consumed challenge cookie',
      should: 'still be rejected because the challenge itself was consumed',
      actual: { replayWithFreshCounter: replayWithFreshCounter.ok },
      expected: { replayWithFreshCounter: false },
    });
  });

  test('a completed assertion emits the authenticated lifecycle event (AUTH-6.4)', async () => {
    const { cookie } = await signUp();
    const { credential } = await flows.enrollPasskey(cookie);
    const events = await recordedEvents(async () => {
      await flows.signInWithPasskey(credential);
    });
    assert({
      given: 'a real passkey assertion that succeeds',
      should: 'emit auth.passkey.authenticated',
      actual: events.filter((event) => event.startsWith('auth.passkey.')),
      expected: ['auth.passkey.authenticated'],
    });
  });

  test('an unenrolled credential id is rejected', async () => {
    const credential = await createSoftwareCredential();
    const { verifyResponse } = await flows.signInWithPasskey(credential);
    assert({
      given: 'an assertion for a credential id nobody registered',
      should: 'be rejected without a session',
      actual: verifyResponse.ok,
      expected: false,
    });
  });
});
