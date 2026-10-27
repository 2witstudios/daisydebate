import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authenticationOptions,
  canonicalCeremony,
  registrationOptions,
  responseChallenge,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn';
import { softAuthenticator } from './soft-authenticator.test-support';

setupRitewayBun();
const bytes = new Uint8Array(32).fill(7);
const challenge = Buffer.from(bytes).toString('base64url');

test('ceremony options', async () => {
  const create = await registrationOptions({
    operatorId: 'operator1',
    displayName: 'owner',
    challenge: bytes,
    existing: [
      {
        credentialId: 'old',
        publicKey: 'k',
        signCount: 0,
        transports: ['usb', 'bogus'],
      },
    ],
  });
  const get = await authenticationOptions(bytes);
  assert({
    given: 'a register and a sign-in challenge',
    should: 'require user verification on RP ID localhost with that challenge',
    actual: [
      create.rp.id,
      create.challenge,
      create.authenticatorSelection?.userVerification,
      create.excludeCredentials,
      get.rpId,
      get.challenge,
      get.userVerification,
    ],
    expected: [
      'localhost',
      challenge,
      'required',
      [{ id: 'old', type: 'public-key', transports: ['usb'] }],
      'localhost',
      challenge,
      'required',
    ],
  });
});

test('verifyRegistration', async () => {
  const device = await softAuthenticator(1);
  const verify = async (
    response: Awaited<ReturnType<typeof device.register>>,
    expected = challenge,
  ) =>
    verifyRegistration({
      response,
      challenge: expected,
      ceremony: canonicalCeremony,
    });
  const ok = await verify(await device.register(challenge, canonicalCeremony));
  assert({
    given: 'a user-verified attestation on the canonical origin',
    should: 'yield the credential with its counter and backup state',
    actual: [ok?.credentialId, ok?.signCount, ok?.backedUp, ok?.transports],
    expected: [device.id, 0, false, ['internal']],
  });
  const refused = await Promise.all([
    device
      .register(challenge, canonicalCeremony, { userVerified: false })
      .then((response) => verify(response)),
    device
      .register(challenge, {
        origin: 'http://127.0.0.1:4800',
        rpId: 'localhost',
      })
      .then((response) => verify(response)),
    device
      .register(challenge, {
        origin: 'http://localhost:4800',
        rpId: 'evil.example',
      })
      .then((response) => verify(response)),
    device
      .register(challenge, canonicalCeremony)
      .then((response) => verify(response, 'another-challenge')),
  ]);
  assert({
    given: 'no user verification, a wrong origin, RP ID or challenge',
    should: 'refuse each one',
    actual: refused,
    expected: [null, null, null, null],
  });
});

test('verifyAuthentication', async () => {
  const device = await softAuthenticator(2);
  const registered = await verifyRegistration({
    response: await device.register(challenge, canonicalCeremony),
    challenge,
    ceremony: canonicalCeremony,
  });
  const credential = { ...registered!, signCount: 9 };
  const verify = async (response: Awaited<ReturnType<typeof device.assert>>) =>
    verifyAuthentication({
      response,
      challenge,
      credential,
      ceremony: canonicalCeremony,
    });
  assert({
    given: 'a user-verified assertion whose counter went backwards',
    should: 'verify the signature and leave the counter rule to the caller',
    actual: await verify(await device.assert(challenge, canonicalCeremony, 3)),
    expected: { counter: 3, backedUp: false },
  });
  assert({
    given: 'an assertion without user verification',
    should: 'be refused',
    actual: await verify(
      await device.assert(challenge, canonicalCeremony, 10, {
        userVerified: false,
      }),
    ),
    expected: null,
  });
});

test('responseChallenge', async () => {
  const device = await softAuthenticator(3);
  const response = await device.register(challenge, canonicalCeremony);
  assert({
    given: 'a response, and untrusted garbage',
    should: 'read the answered challenge, or nothing',
    actual: [
      responseChallenge(response.response.clientDataJSON),
      responseChallenge('not-json'),
    ],
    expected: [challenge, null],
  });
});
