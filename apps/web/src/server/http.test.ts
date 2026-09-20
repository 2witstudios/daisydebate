import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { readServerConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';

setupRitewayBun();

// Seed process-local resources before touching the HTTP boundary so this test
// never constructs real database or Redis clients.
const recorded: { level: string; message: string; fields: unknown }[] = [];
const recorder: Logger = {
  info: (event, fields, message) =>
    recorded.push({ level: 'info', fields: { event, ...fields }, message }),
  warn: (event, fields, message) =>
    recorded.push({ level: 'warn', fields: { event, ...fields }, message }),
  error: (event, fields, message) =>
    recorded.push({ level: 'error', fields: { event, ...fields }, message }),
  child: () => recorder,
};
const seededResources = {
  config: readServerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_NAMESPACE: 'test',
    PUBLIC_APP_URL: 'http://localhost:3000',
    APP_VERSION: 'test',
    GIT_COMMIT: 'test',
  }),
  logger: recorder,
  draining: false,
};
Reflect.set(globalThis, 'daisyResources', seededResources);

const { handleOperation, readJson, requireSameOrigin } = await import('./http');

const jsonRequest = (body: string, contentType = 'application/json') =>
  new Request('http://localhost/api/foundation/proof', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });

describe('readJson', () => {
  test('parses bounded JSON bodies', async () => {
    assert({
      given: 'a JSON request body',
      should: 'parse it into an object',
      actual: await readJson(jsonRequest('{"a":1}')),
      expected: { a: 1 },
    });
  });

  test('rejects non-JSON content types', () => {
    expect(() =>
      readJson(jsonRequest('a=1', 'application/x-www-form-urlencoded')),
    ).toThrow(createAppError('VALIDATION'));
  });

  test('rejects bodies beyond the byte bound', async () => {
    const large = JSON.stringify({ text: 'x'.repeat(128) });
    await expect(readJson(jsonRequest(large), 64)).rejects.toThrow(
      createAppError('VALIDATION'),
    );
  });

  test('rejects malformed JSON', async () => {
    await expect(readJson(jsonRequest('{nope'))).rejects.toThrow(
      createAppError('VALIDATION'),
    );
  });
});

describe('handleOperation', () => {
  test('returns handler responses with correlation headers and logs completion', async () => {
    recorded.length = 0;
    const response = await handleOperation(
      new Request('http://localhost/api/foundation/proof'),
      'test.operation',
      () => Promise.resolve(Response.json({ ok: true })),
    );
    assert({
      given: 'a successful operation',
      should: 'respond 200',
      actual: response.status,
      expected: 200,
    });
    assert({
      given: 'a completed operation',
      should: 'attach a correlation header',
      actual: Boolean(response.headers.get('x-request-id')),
      expected: true,
    });
    assert({
      given: 'a completed operation',
      should: 'log completion at info level',
      actual: recorded.at(-1)?.level,
      expected: 'info',
    });
  });

  test('honors caller request IDs that pass the format constraint', async () => {
    const response = await handleOperation(
      new Request('http://localhost/api/foundation/proof', {
        headers: { 'x-request-id': 'caller-provided-id-123' },
      }),
      'test.operation',
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
    assert({
      given: 'a caller-provided request id',
      should: 'echo it on the response',
      actual: response.headers.get('x-request-id'),
      expected: 'caller-provided-id-123',
    });
  });

  test('maps domain invariants to stable public errors without leaking internals', async () => {
    const internalDetail = 'participant row 3481 violated archetype storage';
    const response = await handleOperation(
      new Request('http://localhost/api/foundation/proof'),
      'test.operation',
      () =>
        Promise.reject(
          createAppError('INVARIANT', `Secret detail: ${internalDetail}`),
        ),
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    assert({
      given: 'a rejected domain invariant',
      should: 'respond 422',
      actual: response.status,
      expected: 422,
    });
    assert({
      given: 'a rejected domain invariant',
      should: 'emit the stable INVARIANT code',
      actual: body.error.code,
      expected: 'INVARIANT',
    });
    assert({
      given: 'a rejected domain invariant',
      should: 'use the stable public message',
      actual: body.error.message,
      expected: 'Domain operation is not allowed',
    });
    assert({
      given: 'a rejected domain invariant with internal details',
      should: 'never serialize the details',
      actual: JSON.stringify(body).includes(internalDetail),
      expected: false,
    });
    assert({
      given: 'a mapped public error',
      should: 'include a request id',
      actual: Boolean(body.error.requestId),
      expected: true,
    });
  });

  test('maps unexpected failures to INTERNAL and never exposes causes', async () => {
    const response = await handleOperation(
      new Request('http://localhost/api/foundation/proof'),
      'test.operation',
      () =>
        Promise.reject(
          new Error('ECONNREFUSED 10.0.0.12:5432 from connection pool'),
        ),
    );
    const body = (await response.json()) as { error: { code: string } };
    assert({
      given: 'an unexpected infrastructure failure',
      should: 'respond 500',
      actual: response.status,
      expected: 500,
    });
    assert({
      given: 'an unexpected infrastructure failure',
      should: 'emit the INTERNAL code',
      actual: body.error.code,
      expected: 'INTERNAL',
    });
    assert({
      given: 'an unexpected infrastructure failure',
      should: 'never expose the cause',
      actual: JSON.stringify(body).includes('ECONNREFUSED'),
      expected: false,
    });
  });

  test('cancelled requests log without error-level noise and return 499', async () => {
    recorded.length = 0;
    const controller = new AbortController();
    controller.abort();
    const response = await handleOperation(
      new Request('http://localhost/api/foundation/proof', {
        signal: controller.signal,
      }),
      'test.operation',
      () => Promise.resolve(Response.json({ ok: true })),
    );
    assert({
      given: 'an aborted request',
      should: 'respond 499',
      actual: response.status,
      expected: 499,
    });
    assert({
      given: 'an aborted request',
      should: 'log at warn level only',
      actual: recorded.at(-1)?.level,
      expected: 'warn',
    });
  });

  test('maps resource construction failures through the public error contract', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    Reflect.deleteProperty(globalThis, 'daisyResources');
    process.env.DATABASE_URL = 'not-a-postgres-url';
    try {
      const response = await handleOperation(
        new Request('http://localhost/api/foundation/proof'),
        'test.operation',
        () => Promise.resolve(Response.json({ ok: true })),
      );
      const body = (await response.json()) as { error: { code: string } };
      assert({
        given: 'unconstructable process resources',
        should: 'respond with the mapped public error',
        actual: { status: response.status, code: body.error.code },
        expected: { status: 500, code: 'INTERNAL' },
      });
      assert({
        given: 'unconstructable process resources',
        should: 'attach a correlation header',
        actual: Boolean(response.headers.get('x-request-id')),
        expected: true,
      });
    } finally {
      if (previousDatabaseUrl === undefined)
        Reflect.deleteProperty(process.env, 'DATABASE_URL');
      else process.env.DATABASE_URL = previousDatabaseUrl;
      Reflect.set(globalThis, 'daisyResources', seededResources);
    }
  });

  test('rejects cross-origin state-changing requests', () => {
    expect(() =>
      requireSameOrigin(
        new Request('http://localhost/api/foundation/proof', {
          headers: { origin: 'https://evil.example' },
        }),
        'http://localhost:3000',
      ),
    ).toThrow(createAppError('AUTHORIZATION'));
  });
});
