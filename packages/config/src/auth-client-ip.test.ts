import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readAuthConfig } from './index';

setupRitewayBun();

const authEnv = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'https://daisy.example.com',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};

const failure = (overrides: Record<string, string>) => {
  try {
    readAuthConfig({ ...authEnv, ...overrides });
    return 'accepted';
  } catch (error) {
    return String(error);
  }
};

describe('auth client-IP trust configuration', () => {
  test('defaults to trusting no header and no proxy', () => {
    const blank = readAuthConfig({
      ...authEnv,
      AUTH_TRUSTED_IP_HEADERS: ' ',
      AUTH_TRUSTED_PROXIES: '',
    });
    const absent = readAuthConfig(authEnv);
    assert({
      given: 'absent or blank client-IP trust variables',
      should: 'believe no request header and name no proxy',
      actual: [
        absent.AUTH_TRUSTED_IP_HEADERS,
        absent.AUTH_TRUSTED_PROXIES,
        blank.AUTH_TRUSTED_IP_HEADERS,
        blank.AUTH_TRUSTED_PROXIES,
      ],
      expected: [[], [], [], []],
    });
  });

  test('parses comma-separated header names and proxies', () => {
    const config = readAuthConfig({
      ...authEnv,
      AUTH_TRUSTED_IP_HEADERS: 'x-real-ip, CF-Connecting-IP',
      AUTH_TRUSTED_PROXIES: '10.0.0.1, 10.1.0.0/16 ,2001:db8::1,2001:db8::/32',
    });
    assert({
      given: 'comma-separated lists with surrounding whitespace',
      should: 'return trimmed header names and IPv4/IPv6 addresses and ranges',
      actual: [config.AUTH_TRUSTED_IP_HEADERS, config.AUTH_TRUSTED_PROXIES],
      expected: [
        ['x-real-ip', 'CF-Connecting-IP'],
        ['10.0.0.1', '10.1.0.0/16', '2001:db8::1', '2001:db8::/32'],
      ],
    });
  });

  test('rejects a header name that is not an HTTP token', () => {
    const message = failure({
      AUTH_TRUSTED_IP_HEADERS: 'x-real-ip,bad header:198.51.100.9',
    });
    assert({
      given: 'a header list containing a non-token name',
      should: 'name the field in the standard error without echoing the value',
      actual: {
        standard: message.includes('Invalid auth configuration'),
        named: message.includes('AUTH_TRUSTED_IP_HEADERS'),
        echoed: message.includes('198.51.100.9') || message.includes('bad'),
      },
      expected: { standard: true, named: true, echoed: false },
    });
  });

  test('rejects an empty entry between commas', () => {
    const message = failure({
      AUTH_TRUSTED_IP_HEADERS: 'x-real-ip,,x-client-ip',
      AUTH_TRUSTED_PROXIES: '10.0.0.1,,10.0.0.2',
    });
    assert({
      given: 'header and proxy lists each containing an empty entry',
      should: 'reject both fields rather than silently dropping the entry',
      actual: [
        message.includes('AUTH_TRUSTED_IP_HEADERS'),
        message.includes('AUTH_TRUSTED_PROXIES'),
      ],
      expected: [true, true],
    });
  });

  test('rejects proxies that are not an IP address or CIDR range', () => {
    const invalid = [
      'proxy.internal',
      '10.0.0.256',
      '10.0.0.0/33',
      '2001:db8::/129',
      '10.0.0.1/',
    ];
    assert({
      given: 'proxy entries that are not an IP address or a valid range',
      should: 'reject every one by field name without echoing the value',
      actual: invalid.map((entry) => {
        const message = failure({ AUTH_TRUSTED_PROXIES: `10.0.0.1,${entry}` });
        return (
          message.includes('AUTH_TRUSTED_PROXIES') && !message.includes(entry)
        );
      }),
      expected: invalid.map(() => true),
    });
  });

  test('rejects IPv6 proxies that embed an IPv4 address', () => {
    // Better Auth 1.7.5 reduces an IPv4-mapped address to four bytes and
    // caps its prefix at 32, so these ranges would be dropped at runtime.
    const embedded = [
      '::ffff:10.0.0.0/104',
      '::ffff:a00:0/104',
      '0:0:0:0:0:ffff:10.0.0.1/120',
      '::ffff:10.0.0.1',
      '::FFFF:a00:1',
      '64:ff9b::10.0.0.1',
    ];
    assert({
      given: 'IPv4-mapped and dotted IPv6 proxy entries',
      should: 'reject each by field name so operators write the IPv4 form',
      actual: embedded.map((entry) =>
        failure({ AUTH_TRUSTED_PROXIES: entry }).includes(
          'Invalid auth configuration: AUTH_TRUSTED_PROXIES',
        ),
      ),
      expected: embedded.map(() => true),
    });
  });

  test('is deliberately stricter than Better Auth about prefix syntax', () => {
    assert({
      given: 'a leading-zero prefix that Better Auth itself would accept',
      should: 'reject it rather than normalize: one canonical spelling only',
      actual: [
        failure({ AUTH_TRUSTED_PROXIES: '10.0.0.0/08' }).includes(
          'AUTH_TRUSTED_PROXIES',
        ),
        failure({ AUTH_TRUSTED_PROXIES: '10.0.0.0/8' }),
      ],
      expected: [true, 'accepted'],
    });
  });
});
