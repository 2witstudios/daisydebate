import { assert, setupRitewayBun, test } from 'riteway/bun';
import { redactText } from './e2e-artifact-sanitizer';
setupRitewayBun();
for (const depth of [0, 1, 2])
  test(`realtime bearer tickets are redacted at JSON depth ${depth}`, () => {
    const serialize = (value: string) =>
      Array.from({ length: depth }).reduce<string>(
        (text) => JSON.stringify(text),
        value,
      );
    const payload = (ticket: string) =>
      JSON.stringify({
        type: 'hello',
        ticket,
        socketUrl: 'wss://localhost:13014/ws',
      });
    assert({
      given:
        'an issuance or hello ticket in plain or nested serialized trace JSON',
      should:
        'redact only the credential and preserve valid surrounding diagnostic data',
      actual: redactText(serialize(payload('a'.repeat(43)))),
      expected: serialize(payload('[REDACTED]')),
    });
  });

for (const depth of [0, 1, 2])
  for (const header of ['set-cookie', 'cookie', 'authorization'])
    test(`trace header ${header} preserves JSON framing at depth ${depth}`, () => {
      const serialize = (message: string) => {
        let text = JSON.stringify({ type: 'log', message, after: 'retained' });
        for (let index = 0; index < depth; index++) text = JSON.stringify(text);
        return text;
      };
      assert({
        given: 'a serialized trace log containing a credential-bearing header',
        should:
          'redact its value without consuming its closing quote or following record fields',
        actual: redactText(
          serialize(
            `info "request" ${header}: fixture-"secret"\\value\nnext diagnostic`,
          ),
        ),
        expected: serialize(
          `info "request" ${header}: [REDACTED]\nnext diagnostic`,
        ),
      });
    });

test('plain quoted header logs retain whole-value redaction', () => {
  assert({
    given: 'a plain log prefix and quoted cookie value',
    should: 'retain the prefix and redact the entire header value',
    actual: redactText('info "request" cookie: "fixture-secret"; Path=/'),
    expected: 'info "request" cookie: [REDACTED]',
  });
});

for (const header of ['set-cookie', 'cookie', 'authorization'])
  test(`literal redaction marker does not exempt ${header} suffix`, () => {
    assert({
      given:
        'a plain credential header beginning with a literal redaction marker',
      should: 'redact the complete value including its credential suffix',
      actual: redactText(`${header}: [REDACTED]fixture-secret`),
      expected: `${header}: [REDACTED]`,
    });
  });

for (const header of ['set-cookie', 'cookie', 'authorization'])
  for (const shape of ['bracket', 'brace', 'array'])
    test(`${header} redaction includes ${shape} log shape`, () => {
      const fixture = (credential: string) => {
        const value = `${header}: ${credential}`;
        if (shape === 'array') return JSON.stringify([value]);
        return `${shape === 'brace' ? '{info}' : '[info]'} ${value}`;
      };
      assert({
        given: 'a real log shape rather than a redaction exemption',
        should: 'remove the credential and retain its surrounding framing',
        actual: redactText(fixture('fixture-secret')),
        expected: fixture('[REDACTED]'),
      });
    });

test('JSONL trace records preserve separators and adjacent metadata', () => {
  const record = (value: string) =>
    JSON.stringify({
      message: `info "request" cookie: ${value}`,
      after: 'retained',
    });
  const input = `${record('fixture-secret')}\r\n\n${record('another-fixture-secret')}\n`;
  assert({
    given: 'multiple physical trace records separated by CRLF and blank lines',
    should: 'redact each decoded header and preserve valid record boundaries',
    actual: redactText(input),
    expected: `${record('[REDACTED]')}\r\n\n${record('[REDACTED]')}\n`,
  });
});

for (const name of ['Cookie', 'Set-Cookie', 'Authorization'])
  test(`network header ${name} preserves JSON metadata while redacting its value`, () => {
    const record = (value: string) =>
      JSON.stringify({ headers: [{ name, value }], after: 'retained' });
    assert({
      given: 'a trace network name/value header object',
      should:
        'redact the same sensitive header without losing its name or following metadata',
      actual: redactText(record('fixture-secret')),
      expected: record('[REDACTED]'),
    });
  });

test('multiline PEM remains one plain redaction even with a JSON-number body line', () => {
  const key = '-----BEGIN PRIVATE KEY-----\n1234\n-----END PRIVATE KEY-----';
  assert({
    given:
      'plain key material whose interior could independently parse as JSON',
    should: 'redact the complete original key block',
    actual: redactText(key),
    expected: '[REDACTED PRIVATE KEY]',
  });
});

test('trace secure-cookie name/value metadata does not retain its credential', () => {
  const cookie = (value: string) =>
    JSON.stringify({
      cookies: [{ name: '__Secure-daisy.session_token', value }],
      after: 'retained',
    });
  assert({
    given: 'the existing protected cookie name represented as a trace object',
    should: 'redact its value while preserving name and metadata',
    actual: redactText(cookie('fixture-secret')),
    expected: cookie('[REDACTED]'),
  });
});

test('a single changed JSON record retains its trailing CRLF', () => {
  const record = (value: string) =>
    ` ${JSON.stringify({ message: `cookie: ${value}` })}\r\n`;
  assert({
    given: 'a complete JSON record with original surrounding whitespace',
    should: 'redact it without removing its physical record terminator',
    actual: redactText(record('fixture-secret')),
    expected: record('[REDACTED]'),
  });
});
