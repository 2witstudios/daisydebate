import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, toPublicError, type ErrorCode } from '@daisy/errors';
import { errorSchema, type ProtocolError } from '@daisy/protocol';

setupRitewayBun();

// The protocol enum and the error table are declared independently, so the
// web app — which depends on both — pins them together. Typecheck fails if
// either side gains a code the other lacks.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const codesMatch: Same<ErrorCode, ProtocolError['code']> = true;

describe('error code contract', () => {
  test('every protocol error code is one the error table can publish', () => {
    const codes = errorSchema.shape.code.options;
    assert({
      given: 'each code the wire contract enumerates',
      should: 'round-trip through the public error mapping as that code',
      actual: codes.map(
        (code) => toPublicError(createAppError(code), 'r').body.error.code,
      ),
      expected: codes,
    });
    assert({
      given: 'the error table and the protocol enum',
      should: 'enumerate the same codes at the type level',
      actual: codesMatch,
      expected: true,
    });
  });
});
