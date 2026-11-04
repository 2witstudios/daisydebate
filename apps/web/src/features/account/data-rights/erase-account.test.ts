import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../../server/test-loggers.test-support';
import type { RateLimiter } from '../../../server/rate-limit';
import { createEraseAccountHandler } from './erase-account';
import {
  ACCOUNT_CLOSED_QUERY,
  ERASE_ACCOUNT_QUERY,
  draftsErasedCookie,
} from './notices-keys';

setupRitewayBun();
const origin = 'http://localhost:3000';
const now = '2026-10-28T00:00:00.000Z';
const member = {
  state: 'member' as const,
  username: 'tester',
  principal: {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  },
};

const allowedLimiter = (): RateLimiter => ({
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
});
const deniedLimiter = (): RateLimiter => ({
  consume: async () => ({ allowed: false, retryAfterSeconds: 60 }),
});

const request = (headers: Record<string, string>, body?: string) =>
  new Request(`${origin}/api/privacy/erase`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body }),
  });

test('a confirmed member erasure runs once with the session subject and closes the account (ISSUE-833)', async () => {
  const calls: unknown[] = [];
  const response = await createEraseAccountHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async (subject, at) => {
      calls.push({ subject, at });
      return { alreadyErased: false };
    },
  })(
    request(
      {
        origin,
        cookie: 'session=1',
        'content-type': 'application/x-www-form-urlencoded',
      },
      'confirm=on',
    ),
  );
  assert({
    given:
      'a same-origin signed-in member posting the erase form with the confirmation',
    should:
      'run the erasure once with the session subject and the injected clock, and 303 to the sign-in page closed notice',
    actual: [
      calls,
      response.status,
      response.headers.get('location'),
      response.headers.get('set-cookie'),
    ],
    expected: [
      [
        {
          subject: { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
          at: now,
        },
      ],
      303,
      `/sign-in?${ACCOUNT_CLOSED_QUERY}=1`,
      draftsErasedCookie('1', 60),
    ],
  });
});

test('an unconfirmed, cross-origin, rate-limited or anonymous erase never reaches the erasure', async () => {
  const deps = {
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async () => {
      throw new Error('must not run');
    },
  };
  const form = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  const unconfirmed = await createEraseAccountHandler(deps)(
    request({ origin, ...form }, ''),
  );
  const crossOrigin = await createEraseAccountHandler(deps)(
    request({ origin: 'https://evil.example', ...form }, 'confirm=on'),
  );
  const rateLimited = await createEraseAccountHandler({
    ...deps,
    limiter: deniedLimiter,
  })(request({ origin, ...form }, 'confirm=on'));
  const anonymous = await createEraseAccountHandler({
    ...deps,
    identify: async () => ({
      state: 'anonymous',
      principal: { kind: 'anonymous' },
    }),
  })(request({ origin, ...form }, 'confirm=on'));
  assert({
    given:
      'a post without the confirmation, from another origin, over budget, or with no session',
    should:
      'answer 303 to the section or sign-in with the one fixed notice, run no erasure, and clear note copies only for the confirmed post with no session',
    actual: [
      unconfirmed.headers.get('location'),
      crossOrigin.headers.get('location'),
      rateLimited.headers.get('location'),
      anonymous.headers.get('location'),
      [unconfirmed, crossOrigin, rateLimited, anonymous].map((r) => r.status),
      [unconfirmed, crossOrigin, rateLimited, anonymous].map((r) =>
        r.headers.get('set-cookie'),
      ),
    ],
    expected: [
      `/settings?${ERASE_ACCOUNT_QUERY}=confirm`,
      `/settings?${ERASE_ACCOUNT_QUERY}=refused`,
      `/settings?${ERASE_ACCOUNT_QUERY}=rate-limited`,
      '/sign-in',
      [303, 303, 303, 303],
      [null, null, null, draftsErasedCookie('1', 60)],
    ],
  });
});

test('a confirmed request with no session left still clears the note copies', async () => {
  const handler = createEraseAccountHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => ({
      state: 'anonymous',
      principal: { kind: 'anonymous' },
    }),
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async () => {
      throw new Error('must not run');
    },
  });
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const confirmed = await handler(request({ origin, ...form }, 'confirm=on'));
  const unconfirmed = await handler(request({ origin, ...form }, ''));
  const crossOrigin = await handler(
    request({ origin: 'https://evil.example', ...form }, 'confirm=on'),
  );
  assert({
    given:
      'a repeat submit after the closure committed, an unconfirmed post and a cross-origin post',
    should: 'send the erasing cookie only for the confirmed same-origin one',
    actual: [
      confirmed.headers.get('location'),
      confirmed.headers.get('set-cookie'),
      unconfirmed.headers.get('set-cookie'),
      crossOrigin.headers.get('set-cookie'),
    ],
    expected: ['/sign-in', draftsErasedCookie('1', 60), null, null],
  });
});

test('a broken upload with no session is not a refused erasure', async () => {
  const logged: string[] = [];
  const response = await createEraseAccountHandler({
    logger: {
      ...silentLogger,
      log: (event: string) => {
        logged.push(event);
      },
    } as typeof silentLogger,
    origin: () => origin,
    identify: async () => ({
      state: 'anonymous',
      principal: { kind: 'anonymous' },
    }),
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async () => {
      throw new Error('must not run');
    },
  })(
    new Request(`${origin}/api/privacy/erase`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new ReadableStream({
        pull: (controller) => controller.error(new Error('truncated')),
      }),
      duplex: 'half',
    } as RequestInit),
  );
  assert({
    given: 'a body that fails to read, from a visitor with no session',
    should: 'answer the sign-in page, set no cookie and log no erasure failure',
    actual: [
      response.headers.get('location'),
      response.headers.get('set-cookie'),
      logged,
    ],
    expected: ['/sign-in', null, []],
  });
});

test('a waitlisted account keeps its own erasure right (ISSUE-833 review B1)', async () => {
  const calls: unknown[] = [];
  const waitlisted = {
    state: 'waitlisted' as const,
    username: 'tester',
    reason: 'revoked' as const,
    principal: member.principal,
  };
  const response = await createEraseAccountHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => waitlisted,
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async (subject, at) => {
      calls.push({ subject, at });
      return { alreadyErased: false };
    },
  })(
    request(
      { origin, 'content-type': 'application/x-www-form-urlencoded' },
      'confirm=on',
    ),
  );
  assert({
    given:
      'an authenticated account whose beta access was revoked, erasing with confirmation',
    should:
      'run the erasure for exactly its own session subject and 303 to the closed notice, no-store',
    actual: [
      calls,
      response.status,
      response.headers.get('location'),
      response.headers.get('cache-control'),
    ],
    expected: [
      [
        {
          subject: { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
          at: now,
        },
      ],
      303,
      `/sign-in?${ACCOUNT_CLOSED_QUERY}=1`,
      'no-store',
    ],
  });
});

test('an engine refusal is a fixed section notice, never its internals', async () => {
  const response = await createEraseAccountHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: allowedLimiter,
    clock: fixedClock(now),
    eraseSubject: async () => {
      throw createAppError(
        'AUTHORIZATION',
        undefined,
        new Error('private actor mismatch'),
      );
    },
  })(
    request(
      { origin, 'content-type': 'application/x-www-form-urlencoded' },
      'confirm=on',
    ),
  );
  assert({
    given: 'an erasure the engine refuses',
    should: '303 back to the section with the refused notice only',
    actual: [response.status, response.headers.get('location')],
    expected: [303, `/settings?${ERASE_ACCOUNT_QUERY}=refused`],
  });
});
