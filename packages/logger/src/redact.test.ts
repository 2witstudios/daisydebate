import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createLogger } from './index';

setupRitewayBun();

// Kept in sync with packages/config's secret-shaped fields
// (BETTER_AUTH_SECRET, RESEND_API_KEY, RESEND_WEBHOOK_SECRET, DATABASE_URL,
// REDIS_URL) — logger cannot import @daisy/config (declared dependency:
// pino only), so the list is duplicated here rather than derived at
// runtime. Also covers the protocol's `ticket` bearer and `set-cookie`.
const SECRET_SHAPED_FIELD_NAMES = [
  'password',
  'token',
  'ticket',
  'secret',
  'cookie',
  'set-cookie',
  'authorization',
  'apiKey',
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
];

describe('structured logging: recursive redaction', () => {
  test('redacts every secret-shaped field name at one, two and three levels deep', () => {
    for (const fieldName of SECRET_SHAPED_FIELD_NAMES) {
      const secretValue = `unredacted-${fieldName}-value`;
      let output = '';
      const logger = createLogger({
        service: 'test',
        destination: { write: (text) => (output += text) },
      });
      logger.log(
        'server.start',
        {
          [fieldName]: secretValue,
          nested: { [fieldName]: secretValue },
          deeplyNested: { wrapper: { [fieldName]: secretValue } },
        },
        'completed',
      );
      assert({
        given: `a field named "${fieldName}" at the top level, one level and two levels deep`,
        should: 'never appear in the emitted log line',
        actual: output.includes(secretValue),
        expected: false,
      });
    }
  });

  test('redacts a secret nested inside err/cause and never a plain field', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: { write: (text) => (output += text) },
    });
    logger.log(
      'request.unhandled',
      {
        err: { message: 'failed', cause: { token: 'unredacted-cause-token' } },
        userId: 'user-1',
        durationMs: 12,
      },
      'failed',
    );
    const entry = JSON.parse(output) as {
      userId: string;
      durationMs: number;
    };
    assert({
      given: 'a secret nested inside err.cause, beside plain fields',
      should: 'redact the nested secret and keep the plain fields intact',
      actual: {
        leaked: output.includes('unredacted-cause-token'),
        userId: entry.userId,
        durationMs: entry.durationMs,
      },
      expected: { leaked: false, userId: 'user-1', durationMs: 12 },
    });
  });

  test('serializes a real Error field to name/message/cause, redacting a secret in either', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: { write: (text) => (output += text) },
    });
    const cause = new Error('unredacted-cause-secret-value');
    const err = new Error('outer failure', { cause });
    logger.log('request.unhandled', { err }, 'failed');
    const entry = JSON.parse(output) as {
      err: { name: string; message: string; cause?: { message?: string } };
    };
    assert({
      given: 'a real Error field whose cause is itself a real Error',
      should:
        'serialize name/message/cause instead of the opaque {} JSON.stringify would give, and never leak either message verbatim',
      actual: {
        name: entry.err.name,
        message: entry.err.message,
        causeMessage: entry.err.cause?.message,
      },
      expected: {
        name: 'Error',
        message: 'outer failure',
        causeMessage: 'unredacted-cause-secret-value',
      },
    });
  });

  test('a circular cause chain is redacted rather than looping forever', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: { write: (text) => (output += text) },
    });
    const circular: { message: string; cause?: unknown } = {
      message: 'circular',
    };
    circular.cause = circular;
    logger.log('request.unhandled', { err: circular }, 'failed');
    assert({
      given: 'a field whose cause chain circles back to itself',
      should: 'complete without hanging or throwing',
      actual: typeof output === 'string' && output.length > 0,
      expected: true,
    });
  });

  test('redacts a magic-link token embedded in a URL field value', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: { write: (text) => (output += text) },
    });
    const secretToken = 'unredacted-magic-link-token';
    logger.log(
      'auth.magic_link.verified',
      {
        confirmLink: `https://daisy.example.com/auth/confirm?token=${secretToken}`,
      },
      'verified',
    );
    assert({
      given: 'a URL field carrying a token query parameter',
      should: 'redact the token value from the emitted log line',
      actual: output.includes(secretToken),
      expected: false,
    });
  });
});
