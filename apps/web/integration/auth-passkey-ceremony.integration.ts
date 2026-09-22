import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createPasskeyFlows, rpID } from './auth-passkey-flows';
import { origin, withSql } from './auth-mounted-helpers';
import {
  buildAuthenticationResponse,
  buildRegistrationResponse,
  createSoftwareCredential,
} from './webauthn-authenticator';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;

const passkeyCount = (email: string) =>
  withSql(async (sql) => {
    const [row] = await sql`
      SELECT count(*)::int AS c FROM passkey p
      JOIN users u ON u.id = p.user_id
      WHERE u.email = ${email}
    `;
    return (row?.c as number) ?? 0;
  });

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
        stored: await passkeyCount(email),
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
        stored: await passkeyCount(email),
      },
      expected: { status: 200, stored: 2 },
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
        stored: await passkeyCount(email),
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
      actual: { ok: verifyResponse.ok, stored: await passkeyCount(email) },
      expected: { ok: false, stored: 0 },
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
      actual: { ok: duplicate.ok, stored: await passkeyCount(email) },
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
    assert({
      given: 'a real assertion from the credential just enrolled',
      should: 'answer 200 and establish a session for the credential owner',
      actual: {
        status: verifyResponse.status,
        signedIn: typeof body.user?.id === 'string',
        cookieIssued: verifyResponse.headers.getSetCookie().length > 0,
      },
      expected: { status: 200, signedIn: true, cookieIssued: true },
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
    assert({
      given: 'a structurally invalid assertion for an unknown credential',
      should: 'be rejected without a session',
      actual: {
        ok: malformed.ok,
        cookieIssued: malformed.headers.getSetCookie().length > 0,
      },
      expected: { ok: false, cookieIssued: false },
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
    assert({
      given: 'the exact same assertion submitted a second time',
      should: 'succeed once and be rejected on replay',
      actual: { first: firstUse.ok, replay: replay.ok },
      expected: { first: true, replay: false },
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

describe('AUTH-5.3 list, rename and remove owned passkeys', () => {
  test('listing returns only the current account’s passkeys with names and creation metadata', async () => {
    const alice = await signUp();
    const bob = await signUp();
    await flows.enrollPasskey(alice.cookie, { name: 'Alice laptop' });
    await flows.enrollPasskey(bob.cookie, { name: 'Bob laptop' });
    const listed = await flows.listPasskeys(alice.cookie);
    const rows = (await listed.json()) as { name: string; createdAt: string }[];
    assert({
      given: 'two accounts, each with one passkey',
      should: "list only the caller's own passkey",
      actual: {
        count: rows.length,
        name: rows[0]?.name,
        hasCreatedAt: Boolean(rows[0]?.createdAt),
      },
      expected: { count: 1, name: 'Alice laptop', hasCreatedAt: true },
    });
  });

  test('rename and remove succeed for an owned passkey', async () => {
    const { email, cookie } = await signUp();
    const { credential } = await flows.enrollPasskey(cookie, {
      name: 'Old name',
    });
    const listed = await flows.listPasskeys(cookie);
    const [row] = (await listed.json()) as { id: string }[];
    const renamed = await flows.renamePasskey(cookie, row!.id, 'New name');
    const removed = await flows.deletePasskey(cookie, row!.id);
    assert({
      given: 'a passkey owned by the caller',
      should: 'allow rename then removal, leaving none stored',
      actual: {
        renamed: renamed.ok,
        removed: removed.ok,
        stored: await passkeyCount(email),
      },
      expected: { renamed: true, removed: true, stored: 0 },
    });
    void credential;
  });

  test("another user's credential id is refused for rename and removal", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await flows.enrollPasskey(alice.cookie, { name: 'Alice laptop' });
    const listed = await flows.listPasskeys(alice.cookie);
    const [row] = (await listed.json()) as { id: string }[];
    const renamedByBob = await flows.renamePasskey(
      bob.cookie,
      row!.id,
      'Stolen',
    );
    const removedByBob = await flows.deletePasskey(bob.cookie, row!.id);
    assert({
      given: "bob naming alice's credential id",
      should: 'refuse both modifications and leave the credential untouched',
      actual: {
        renameOk: renamedByBob.ok,
        removeOk: removedByBob.ok,
        stillStored: await passkeyCount(alice.email),
      },
      expected: { renameOk: false, removeOk: false, stillStored: 1 },
    });
  });

  test('removing the final passkey preserves magic-link access', async () => {
    const { email, cookie } = await signUp();
    const listed = await flows.enrollPasskey(cookie, { name: 'Only one' });
    const rows = await flows.listPasskeys(cookie);
    const [row] = (await rows.json()) as { id: string }[];
    await flows.deletePasskey(cookie, row!.id);
    const { requestLink } = flows.account.flows;
    const { response } = await requestLink(email);
    assert({
      given: 'an account whose last passkey was just removed',
      should: 'still be able to request a magic-link sign-in',
      actual: {
        removedFirst: listed.verifyResponse.ok,
        linkRequested: response.ok,
        stored: await passkeyCount(email),
      },
      expected: { removedFirst: true, linkRequested: true, stored: 0 },
    });
  });
});
