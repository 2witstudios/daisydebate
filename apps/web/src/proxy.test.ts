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
});
