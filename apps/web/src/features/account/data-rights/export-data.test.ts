import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../../server/test-loggers.test-support';
import type { RateLimiter } from '../../../server/rate-limit';
import { createExportDataHandler } from './export-data';
import { EXPORT_DATA_QUERY } from './notices-keys';

setupRitewayBun();
const origin = 'http://localhost:3000';
const member = {
  state: 'member' as const,
  username: 'tester',
  principal: {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  },
};
const waitlisted = {
  state: 'waitlisted' as const,
  username: 'tester',
  reason: 'pending' as const,
  principal: member.principal,
};
const exported = { users: [{ id: 'u'.repeat(24) }] };

const allowedLimiter = (): RateLimiter => ({
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
});
const deniedLimiter = (): RateLimiter => ({
  consume: async () => ({ allowed: false, retryAfterSeconds: 60 }),
});

const request = (headers: Record<string, string>) =>
  new Request(`${origin}/api/privacy/export`, {
    method: 'POST',
    headers,
  });

test('a same-origin member export answers the JSON download (ISSUE-833)', async () => {
  const subjects: unknown[] = [];
  const response = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: allowedLimiter,
    exportSubject: async (subject) => {
      subjects.push(subject);
      return exported;
    },
  })(
    request({
      origin,
      cookie: 'session=1',
    }),
  );
  assert({
    given: 'a same-origin signed-in member posting the export form',
    should:
      'export exactly the session subject and answer it as a JSON attachment',
    actual: [
      subjects,
      response.status,
      response.headers.get('content-type'),
      response.headers.get('content-disposition'),
    ],
    expected: [
      [{ userId: 'u'.repeat(24), actorId: 'a'.repeat(24) }],
      200,
      'application/json',
      `attachment; filename="daisy-export-${'u'.repeat(24)}.json"`,
    ],
  });
});

test('cross-origin, anonymous and rate-limited exports are refused with fixed notices', async () => {
  const handler = createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: deniedLimiter,
    exportSubject: async () => {
      throw new Error('must not run');
    },
  });
  const crossOrigin = await handler(
    request({ origin: 'https://evil.example' }),
  );
  const rateLimited = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: deniedLimiter,
    exportSubject: async () => exported,
  })(request({ origin }));
  const anonymous = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => ({
      state: 'anonymous',
      principal: { kind: 'anonymous' },
    }),
    limiter: allowedLimiter,
    exportSubject: async () => exported,
  })(request({ origin }));
  const back = (notice: string) =>
    new Response(null, {
      status: 303,
      headers: { location: `/settings?${EXPORT_DATA_QUERY}=${notice}` },
    });
  assert({
    given: 'a cross-site origin, an exhausted budget, or no session at all',
    should:
      'answer 303 to the section or sign-in with the one fixed notice, having run no export',
    actual: [
      crossOrigin.headers.get('location'),
      rateLimited.headers.get('location'),
      anonymous.headers.get('location'),
      [crossOrigin, rateLimited, anonymous].map((r) => r.status),
    ],
    expected: [
      `/settings?${EXPORT_DATA_QUERY}=refused`,
      `/settings?${EXPORT_DATA_QUERY}=rate-limited`,
      '/sign-in',
      [303, 303, 303],
    ],
  });
  void back;
});

test('a waitlisted account keeps its own data rights (ISSUE-833 review B1)', async () => {
  const subjects: unknown[] = [];
  const response = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => waitlisted,
    limiter: allowedLimiter,
    exportSubject: async (subject) => {
      subjects.push(subject);
      return exported;
    },
  })(request({ origin }));
  assert({
    given:
      'an authenticated account whose beta access is pending or revoked, exporting',
    should:
      'run the export for exactly its own session subject and answer no-store',
    actual: [subjects, response.status, response.headers.get('cache-control')],
    expected: [
      [{ userId: 'u'.repeat(24), actorId: 'a'.repeat(24) }],
      200,
      'no-store',
    ],
  });
});

test('the download and the refusals are never cacheable (ISSUE-833 review, minor)', async () => {
  const ok = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => member,
    limiter: allowedLimiter,
    exportSubject: async () => exported,
  })(request({ origin }));
  const refused = await createExportDataHandler({
    logger: silentLogger,
    origin: () => origin,
    identify: async () => ({
      state: 'anonymous',
      principal: { kind: 'anonymous' },
    }),
    limiter: allowedLimiter,
    exportSubject: async () => exported,
  })(request({ origin }));
  assert({
    given: 'a successful download and a refused export',
    should: 'carry Cache-Control: no-store on both',
    actual: [
      ok.headers.get('cache-control'),
      refused.headers.get('cache-control'),
    ],
    expected: ['no-store', 'no-store'],
  });
});
