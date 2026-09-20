import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

setupRitewayBun();

const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('proxy trace context propagation', () => {
  test('forwards a valid traceparent to the application request', () => {
    const response = proxy(
      new NextRequest('https://daisy.invalid/', {
        headers: { traceparent },
      }),
    );

    assert({
      given: 'a valid traceparent from ingress',
      should: 'forward it to the application request unchanged',
      actual: response.headers.get('x-middleware-request-traceparent'),
      expected: traceparent,
    });
  });

  test('does not forward a malformed traceparent', () => {
    const response = proxy(
      new NextRequest('https://daisy.invalid/', {
        headers: { traceparent: 'malformed' },
      }),
    );

    assert({
      given: 'a malformed traceparent from an untrusted request',
      should: 'remove it before the application request',
      actual: response.headers.get('x-middleware-request-traceparent'),
      expected: null,
    });
  });

  test('answers the disabled foundation proof with a real 404 at the edge', () => {
    const previous = process.env.FOUNDATION_PROOF_ENABLED;
    process.env.FOUNDATION_PROOF_ENABLED = 'false';
    try {
      const response = proxy(
        new NextRequest('https://daisy.invalid/foundation'),
      );

      assert({
        given: 'the architectural proof path while the proof is disabled',
        should: 'refuse the request with a 404 carrying the correlation id',
        actual: {
          status: response.status,
          hasRequestId: Boolean(response.headers.get('x-request-id')),
        },
        expected: { status: 404, hasRequestId: true },
      });
    } finally {
      if (previous === undefined) delete process.env.FOUNDATION_PROOF_ENABLED;
      else process.env.FOUNDATION_PROOF_ENABLED = previous;
    }
  });
});
