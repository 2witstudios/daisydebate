import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { errorSchema } from '@daisy/protocol';
import {
  createAppError,
  createInvariantError,
  createRefusal,
  errorCodeOf,
  isAppError,
  isRefusal,
  toPublicError,
} from './index';

setupRitewayBun();

describe('isRefusal', () => {
  test('only a minted CONFLICT or AUTHORIZATION is a refusal', () => {
    assert({
      given:
        'a CONFLICT, an AUTHORIZATION, an INFRASTRUCTURE app error, and a stray Error',
      should: 'count the first two as refusals only',
      actual: [
        createAppError('CONFLICT'),
        createAppError('AUTHORIZATION'),
        createAppError('INFRASTRUCTURE'),
        Object.assign(new Error('x'), { code: 'CONFLICT' }),
      ].map(isRefusal),
      expected: [true, true, false, false],
    });
  });
});

describe('isAppError', () => {
  test('recognizes errors minted by the public factory', () => {
    assert({
      given: 'an error created through createAppError',
      should: 'be recognized as an app error',
      actual: isAppError(createAppError('NOT_FOUND')),
      expected: true,
    });
  });

  test('rejects lookalikes that merely carry a code property', () => {
    assert({
      given: 'a driver error with a code property',
      should: 'not be recognized as an app error',
      actual: isAppError(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ERR_POSTGRES_CONNECTION_REFUSED',
        }),
      ),
      expected: false,
    });
    assert({
      given: 'a plain object claiming an error code',
      should: 'not be recognized as an app error',
      actual: isAppError({ code: 'VALIDATION' }),
      expected: false,
    });
    assert({
      given: 'a non-error value',
      should: 'not be recognized as an app error',
      actual: isAppError(undefined),
      expected: false,
    });
  });
});

describe('error mapping', () => {
  test('every public error body parses with the protocol errorSchema', () => {
    const codes = errorSchema.shape.code.options;
    assert({
      given: 'an error of every protocol code at a public boundary',
      should: 'produce an error body the protocol errorSchema accepts',
      actual: codes.map(
        (code) =>
          errorSchema.safeParse(
            toPublicError(createAppError(code), 'request-1').body.error,
          ).success,
      ),
      expected: codes.map(() => true),
    });
    assert({
      given: 'a registered invariant failure at a public boundary',
      should: 'produce an error body the protocol errorSchema accepts',
      actual: errorSchema.safeParse(
        toPublicError(
          createInvariantError('debate.phase.completed.terminal'),
          'r',
        ).body.error,
      ).success,
      expected: true,
    });
    assert({
      given: 'an unknown thrown value at a public boundary',
      should: 'publish an INTERNAL body the protocol errorSchema accepts',
      actual: errorSchema.parse(
        toPublicError(new Error('boom'), 'r').body.error,
      ).code,
      expected: 'INTERNAL',
    });
  });

  test('maps an oversized payload to HTTP 413 with a fixed public message', () => {
    assert({
      given: 'a payload-too-large error at a public boundary',
      should: 'map to a stable 413 body',
      actual: toPublicError(createAppError('PAYLOAD_TOO_LARGE'), 'request-1'),
      expected: {
        status: 413,
        body: {
          error: {
            version: 1,
            type: 'error',
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body too large',
            requestId: 'request-1',
          },
        },
      },
    });
  });

  test('preserves a stable invariant identity at the public boundary', () => {
    const error = createInvariantError(
      'debate.phase.active.requires-ready-participants',
    );
    assert({
      given: 'a registered invariant failure',
      should: 'carry its stable invariant identity internally',
      actual: error.invariantId,
      expected: 'debate.phase.active.requires-ready-participants',
    });
    assert({
      given: 'a registered invariant failure at a public boundary',
      should: 'include its stable invariant identity in the error body',
      actual: toPublicError(error, 'request-1').body.error.invariantId,
      expected: 'debate.phase.active.requires-ready-participants',
    });
  });

  test('internal details and cause never cross the public boundary', () => {
    const cause = new Error('password=secret');
    const error = createAppError('INFRASTRUCTURE', 'postgres://secret', cause);
    assert({
      given: 'an infrastructure error created with a cause',
      should: 'retain the cause internally',
      actual: error.cause,
      expected: cause,
    });
    assert({
      given: 'an infrastructure error at a public boundary',
      should: 'map to a stable 503 body with a request id',
      actual: toPublicError(error, 'request-1'),
      expected: {
        status: 503,
        body: {
          error: {
            version: 1,
            type: 'error',
            code: 'INFRASTRUCTURE',
            message: 'Service temporarily unavailable',
            requestId: 'request-1',
          },
        },
      },
    });
    assert({
      given: 'an unexpected error carrying a secret',
      should: 'serialize without the secret',
      actual: JSON.stringify(toPublicError(cause, 'request-1')).includes(
        'secret',
      ),
      expected: false,
    });
    assert({
      given: 'a forged payload claiming a public code',
      should: 'map to INTERNAL status',
      actual: toPublicError({ code: 'VALIDATION', message: 'forged' }, 'r')
        .status,
      expected: 500,
    });
  });
});

describe('createRefusal', () => {
  test('carries a closed reason beside a free message', () => {
    const refusal = createRefusal('CONFLICT', 'active-room', 'Reworded', 'why');
    assert({
      given: 'a refusal with a reason, a message and a cause',
      should: 'mint a known app error holding each',
      actual: [
        isAppError(refusal),
        refusal.code,
        refusal.reason,
        refusal.message,
        refusal.cause,
      ],
      expected: [true, 'CONFLICT', 'active-room', 'Reworded', 'why'],
    });
  });
  test('names itself in a trace when no message is given', () => {
    assert({
      given: 'a refusal with only a reason',
      should: 'carry the word as its internal message',
      actual: createRefusal('CONFLICT', 'active-room').message,
      expected: 'active-room',
    });
  });
  test('never exposes its internal text', () => {
    const { status, body } = toPublicError(
      createRefusal('CONFLICT', 'active-room', 'Internal sentence'),
      'r'.repeat(24),
    );
    assert({
      given: 'a refusal with an internal message',
      should: "answer the code's fixed public message",
      actual: [status, body.error.message],
      expected: [409, 'Resource conflict'],
    });
  });
});

test('errorCodeOf reads only a minted code and otherwise takes the fallback', () => {
  const minted = createAppError('CONFLICT', 'lease held by another role');
  const lookalike = Object.assign(new Error('forged'), { code: 'CONFLICT' });
  assert({
    given:
      'a minted CONFLICT, a lookalike carrying code CONFLICT, and a string',
    should: 'read CONFLICT from the minted error only',
    actual: [minted, lookalike, 'oops'].map((error) =>
      errorCodeOf(error, 'INFRASTRUCTURE'),
    ),
    expected: ['CONFLICT', 'INFRASTRUCTURE', 'INFRASTRUCTURE'],
  });
});
