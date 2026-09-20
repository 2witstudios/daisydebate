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

  test('treats a whitespace-only assignment as absent and fills it', () => {
    const result = provisionAuthSecret('BETTER_AUTH_SECRET=   \n', {
      generate: () => marker,
    });
    assert({
      given: 'a .env whose BETTER_AUTH_SECRET line holds only whitespace',
      should: 'replace the blank value with a generated one',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=${marker}\n`,
    });
  });

  test('treats a CRLF blank assignment as absent and keeps the line ending', () => {
    const result = provisionAuthSecret('BETTER_AUTH_SECRET=\r\n', {
      generate: () => marker,
    });
    assert({
      given: 'a CRLF .env whose BETTER_AUTH_SECRET line has no value',
      should: 'fill the value and keep the CRLF ending',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=${marker}\r\n`,
    });
  });

  test('honors the last assignment when the variable is duplicated', () => {
    const content = 'BETTER_AUTH_SECRET=\nBETTER_AUTH_SECRET=kept\n';
    const result = provisionAuthSecret(content, { generate: () => marker });
    assert({
      given: 'an empty assignment followed by a valued duplicate',
      should: 'preserve the file because the last value wins',
      actual: { changed: result.changed, content: result.content },
      expected: { changed: false, content },
    });
  });

  test('fills only the last assignment when later duplicates are empty', () => {
    const content = 'BETTER_AUTH_SECRET=stale\nBETTER_AUTH_SECRET=\n';
    const result = provisionAuthSecret(content, { generate: () => marker });
    assert({
      given: 'a valued assignment followed by an empty duplicate',
      should: 'replace the effective last assignment only',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=stale\nBETTER_AUTH_SECRET=${marker}\n`,
    });
  });

  test('writes generated values containing replacement patterns literally', () => {
    const dollarSecret = `$&${'x'.repeat(62)}`;
    const result = provisionAuthSecret('BETTER_AUTH_SECRET=\n', {
      generate: () => dollarSecret,
    });
    assert({
      given: 'a generated value containing `$&`',
      should: 'write the value literally without pattern interpretation',
      actual: result.content,
      expected: `BETTER_AUTH_SECRET=${dollarSecret}\n`,
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
