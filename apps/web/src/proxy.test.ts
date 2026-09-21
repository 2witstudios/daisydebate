import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createHash } from 'node:crypto';
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

const directives = (env: 'production' | 'development') => {
  const previous = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', env);
  try {
    const policy =
      proxy(new NextRequest('https://daisy.invalid/')).headers.get(
        'Content-Security-Policy',
      ) ?? '';
    return new Map(
      policy.split('; ').map((directive) => {
        const [name = '', ...sources] = directive.split(' ');
        return [name, sources] as const;
      }),
    );
  } finally {
    Reflect.set(process.env, 'NODE_ENV', previous);
  }
};

describe('proxy content security policy', () => {
  test('keeps production style elements nonce-only', () => {
    const sources = directives('production').get('style-src') ?? [];
    assert({
      given: 'a production request',
      should: 'authorize style elements by nonce without unsafe-inline',
      actual: {
        self: sources.includes("'self'"),
        nonce: sources.some((source) => source.startsWith("'nonce-")),
        unsafeInline: sources.includes("'unsafe-inline'"),
      },
      expected: { self: true, nonce: true, unsafeInline: false },
    });
  });

  test('authorizes only the exact next/image style attributes by hash', () => {
    const hash = (style: string) =>
      `'sha256-${createHash('sha256').update(style).digest('base64')}'`;
    assert({
      given: 'a production request',
      should:
        'allow the fill and default next/image style attributes and nothing else',
      actual: directives('production').get('style-src-attr'),
      expected: [
        "'unsafe-hashes'",
        hash(
          'position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent',
        ),
        hash('color:transparent'),
      ],
    });
  });

  test('leaves development on the permissive style policy', () => {
    assert({
      given: 'a development request',
      should: 'not emit a separate style attribute directive',
      actual: directives('development').has('style-src-attr'),
      expected: false,
    });
  });
});
