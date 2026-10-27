import { createHash } from 'node:crypto';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  EMAILED_LINK_PURPOSES,
  emailedLinkIdentifier,
  generateEmailedLinkToken,
  SIGN_IN_STORED_PURPOSE,
  storedSignInIdentifier,
} from './emailed-link-token';

setupRitewayBun();

const sha3 = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

describe('ISSUE-2 emailed-link tokens', () => {
  test('a fresh token is 256 CSPRNG bits, base64url, and never repeats', () => {
    const tokens = Array.from({ length: 64 }, generateEmailedLinkToken);
    assert({
      given: '64 freshly generated emailed-link tokens',
      should:
        'each be 43 base64url characters (32 bytes, at least 128 bits) and all distinct',
      actual: {
        shapes: tokens.every((token) => /^[A-Za-z0-9_-]{43}$/.test(token)),
        bytes: Buffer.from(tokens[0] ?? '', 'base64url').length,
        distinct: new Set(tokens).size,
      },
      expected: { shapes: true, bytes: 32, distinct: 64 },
    });
  });

  test('the stored identifier is the purpose and the SHA3-256 digest, never the token', () => {
    const token = generateEmailedLinkToken();
    const identifier = emailedLinkIdentifier('email-change-verify', token);
    assert({
      given: 'a token stored for the email-change verification purpose',
      should: 'be keyed by the purpose and the SHA3-256 hex digest only',
      actual: {
        identifier,
        containsToken: identifier.includes(token),
      },
      expected: {
        identifier: `email-change-verify:${sha3(token)}`,
        containsToken: false,
      },
    });
  });

  test('one token hashes to a different identifier under every purpose', () => {
    const token = generateEmailedLinkToken();
    const identifiers = EMAILED_LINK_PURPOSES.map((purpose) =>
      emailedLinkIdentifier(purpose, token),
    );
    assert({
      given: 'the same token under each emailed-link purpose',
      should:
        'give a distinct identifier per purpose, so no token redeems outside the purpose it was issued for',
      actual: new Set(identifiers).size,
      expected: EMAILED_LINK_PURPOSES.length,
    });
  });
});

test('a sign-in link is stored under the prefix Better Auth gives magic links', () => {
  const token = generateEmailedLinkToken();
  assert({
    given: 'a sign-in token and Better Auth 1.7.7 magic-link purpose isolation',
    should:
      'be stored as magic-link: plus the sign-in identifier, which readers find by the stored purpose prefix',
    actual: {
      identifier: storedSignInIdentifier(token),
      prefixed: storedSignInIdentifier(token).startsWith(
        `${SIGN_IN_STORED_PURPOSE}:`,
      ),
    },
    expected: {
      identifier: `magic-link:sign-in:${sha3(token)}`,
      prefixed: true,
    },
  });
});
