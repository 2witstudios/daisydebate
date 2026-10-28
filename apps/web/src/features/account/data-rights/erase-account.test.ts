import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../../server/test-loggers.test-support';
import type { RateLimiter } from '../../../server/rate-limit';
import { createEraseAccountHandler } from './erase-account';
import { ACCOUNT_CLOSED_QUERY, ERASE_ACCOUNT_QUERY } from './notices-keys';

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
    actual: [calls, response.status, response.headers.get('location')],
    expected: [
      [
        {
          subject: { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
          at: now,
        },
      ],
      303,
      `/sign-in?${ACCOUNT_CLOSED_QUERY}=1`,
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
      'answer 303 to the section or sign-in with the one fixed notice and run no erasure',
    actual: [
      unconfirmed.headers.get('location'),
      crossOrigin.headers.get('location'),
      rateLimited.headers.get('location'),
      anonymous.headers.get('location'),
      [unconfirmed, crossOrigin, rateLimited, anonymous].map((r) => r.status),
    ],
    expected: [
      `/settings?${ERASE_ACCOUNT_QUERY}=confirm`,
      `/settings?${ERASE_ACCOUNT_QUERY}=refused`,
      `/settings?${ERASE_ACCOUNT_QUERY}=rate-limited`,
      '/sign-in',
      [303, 303, 303, 303],
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
