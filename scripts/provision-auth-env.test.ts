import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { generateAuthSecret, provisionAuthSecret } from './provision-auth-env';

setupRitewayBun();

const marker = 'm'.repeat(64);

describe('auth secret provisioning', () => {
  test('appends a generated value when the variable is absent', () => {
    const content = 'DATABASE_URL=postgres://localhost/daisy\n';
    const result = provisionAuthSecret(content, { generate: () => marker });
    assert({
      given: 'a .env without BETTER_AUTH_SECRET',
      should: 'append the generated value and keep every existing line',
      actual: {
        changed: result.changed,
        hasSecretLine: result.content.includes(
          `BETTER_AUTH_SECRET=${marker}\n`,
        ),
        keepsExisting: result.content.includes(
          'DATABASE_URL=postgres://localhost/daisy\n',
        ),
      },
      expected: { changed: true, hasSecretLine: true, keepsExisting: true },
    });
  });

  test('preserves an existing value without invoking the generator', () => {
    let generateCalls = 0;
    const content =
      'PUBLIC_APP_URL=http://localhost:3000\nBETTER_AUTH_SECRET=existing\n';
    const result = provisionAuthSecret(content, {
      generate: () => {
        generateCalls += 1;
        return marker;
      },
    });
    assert({
      given: 'a .env with an existing BETTER_AUTH_SECRET value',
      should: 'preserve the file and never generate',
      actual: {
        changed: result.changed,
        content: result.content,
        generateCalls,
      },
      expected: {
        changed: false,
        content,
        generateCalls: 0,
      },
    });
  });

  test('treats an empty assignment as absent and fills it', () => {
    const result = provisionAuthSecret('BETTER_AUTH_SECRET=\n', {
      generate: () => marker,
    });
    assert({
      given: 'a .env whose BETTER_AUTH_SECRET line has no value',
      should: 'replace the empty value with a generated one',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=${marker}\n`,
    });
  });

  test('appends with a separating newline when the file lacks a trailing one', () => {
    const result = provisionAuthSecret('LOG_LEVEL=info', {
      generate: () => marker,
    });
    assert({
      given: 'a .env without a trailing newline',
      should: 'start the generated line on its own line',
      actual: result.content,
      expected: `LOG_LEVEL=info\nBETTER_AUTH_SECRET=${marker}\n`,
    });
  });

  test('handles a completely empty file', () => {
    const result = provisionAuthSecret('', { generate: () => marker });
    assert({
      given: 'empty .env content',
      should: 'produce just the secret line',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=${marker}\n`,
    });
  });

  test('the real generator emits 64 hexadecimal characters', () => {
    const secret = generateAuthSecret();
    assert({
      given: 'the cryptographic generator',
      should: 'emit 64 hex characters from 32 random bytes',
      actual: /^[0-9a-f]{64}$/.test(secret),
      expected: true,
    });
    expect(() =>
      provisionAuthSecret('', { generate: () => 'short' }),
    ).toThrow();
  });
});
