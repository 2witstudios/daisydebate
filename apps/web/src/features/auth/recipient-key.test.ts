import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  deriveRecipientSubkey,
  normalizeEmail,
  recipientKey,
} from './recipient-key';

setupRitewayBun();

describe('normalizeEmail', () => {
  test('trims and lowercases the address', () => {
    assert({
      given: 'an address with surrounding whitespace and mixed case',
      should: 'return the trimmed, lowercased form',
      actual: normalizeEmail(' Player@Daisy.example.com '),
      expected: 'player@daisy.example.com',
    });
  });
});

describe('deriveRecipientSubkey', () => {
  test('is deterministic and domain-separated from the raw secret', () => {
    const secret = 'a'.repeat(64);
    assert({
      given: 'the same BETTER_AUTH_SECRET twice',
      should: 'derive the identical subkey, distinct from the raw secret',
      actual: {
        deterministic:
          deriveRecipientSubkey(secret) === deriveRecipientSubkey(secret),
        distinctFromSecret: deriveRecipientSubkey(secret) !== secret,
      },
      expected: { deterministic: true, distinctFromSecret: true },
    });
  });

  test('matches the known-answer vector under its domain-separation label', () => {
    // Computed independently (Python hashlib.sha3_256):
    // SHA3-256('a' x 64, NUL, 'recipient-key'), then
    // SHA3-256(subkey hex, NUL, 'player@daisy.example.com').
    const subkey = deriveRecipientSubkey('a'.repeat(64));
    assert({
      given: "BETTER_AUTH_SECRET 'a' x 64 and a normalized recipient",
      should:
        'derive the labelled subkey and recipient key exactly, never the bare-secret hash',
      actual: {
        subkey,
        key: recipientKey(subkey, ' Player@Daisy.example.com '),
      },
      expected: {
        subkey:
          '8acc3d0cc3274d2fcc51066cd59d9796d2d4b05c870a93032bc0d22424a13feb',
        key: '9f8f8202a5cbbc0db751822905174a8e743ec8395b03c78ee122386d81033bea',
      },
    });
  });

  test('a different secret derives a different subkey', () => {
    assert({
      given: 'two different secrets',
      should: 'derive two different subkeys',
      actual:
        deriveRecipientSubkey('a'.repeat(64)) ===
        deriveRecipientSubkey('b'.repeat(64)),
      expected: false,
    });
  });
});

describe('recipientKey', () => {
  const subkey = deriveRecipientSubkey('a'.repeat(64));

  test('normalizes the address before keying, and never carries the address', () => {
    const plain = recipientKey(subkey, 'player@daisy.example.com');
    const noisy = recipientKey(subkey, ' Player@Daisy.example.com ');
    assert({
      given: 'the same address with different case and padding',
      should: 'produce the identical hex key without embedding the address',
      actual: {
        same: plain === noisy,
        hex: /^[0-9a-f]{64}$/.test(plain),
        leaksAddress: plain.toLowerCase().includes('player'),
      },
      expected: { same: true, hex: true, leaksAddress: false },
    });
  });

  test('is keyed: the same address under a different subkey produces a different key', () => {
    const otherSubkey = deriveRecipientSubkey('b'.repeat(64));
    assert({
      given: 'the same address under two different subkeys',
      should: 'produce two different keys',
      actual:
        recipientKey(subkey, 'player@daisy.example.com') ===
        recipientKey(otherSubkey, 'player@daisy.example.com'),
      expected: false,
    });
  });

  test('two different addresses produce two different keys', () => {
    assert({
      given: 'two different addresses under the same subkey',
      should: 'produce two different keys',
      actual:
        recipientKey(subkey, 'player@daisy.example.com') ===
        recipientKey(subkey, 'other@daisy.example.com'),
      expected: false,
    });
  });
});
