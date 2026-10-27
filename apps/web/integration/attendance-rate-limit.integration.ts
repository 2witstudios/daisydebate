import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestApp, origin } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

setupRitewayBun();
requireTestServices(process.env);

async function attendanceMember() {
  const app = createTestApp({
    ROOM_POLICY: JSON.stringify({
      consentTtlMs: 60_000,
      maxBodyBytes: 1024,
      limits: Object.fromEntries(
        ['create', 'read', 'command'].map((name) => [
          name,
          { max: 200, windowSeconds: 60 },
        ]),
      ),
    }),
  });
  const accounts = createAccountFlows(app);
  const signed = await accounts.signUp();
  const claimed = await accounts.claim(signed.cookie, {
    username: uniqueName(),
  });
  if (claimed.status !== 201) throw new Error('Member fixture claim failed');
  return { app, cookie: signed.cookie };
}

test('attendance enforces the real Redis member budget before envelope admission', async () => {
  const { app, cookie } = await attendanceMember();
  const statuses = [];
  for (let index = 0; index < 121; index++) {
    const roundId = createId();
    const response = await app.routes.attendance.checkIn(
      new Request(`${origin}/api/rounds/${roundId}/check-in`, {
        method: 'POST',
        headers: {
          origin,
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          commandId: createId(),
          ...(index === 120 ? { segmentId: createId() } : {}),
        }),
      }),
      roundId,
    );
    statuses.push(response.status);
  }
  assert({
    given:
      '120 invalid envelopes across distinct unverified round ids, then a valid envelope from the same real member',
    should: 'spend one shared Redis budget and refuse request 121',
    actual: statuses,
    expected: [...Array<number>(120).fill(400), 429],
  });
});

test('signed attendance for a missing Round answers absence instead of infrastructure (ISSUE-653)', async () => {
  const { app, cookie } = await attendanceMember();
  const roundId = createId();
  const response = await app.routes.attendance.checkIn(
    new Request(`${origin}/api/rounds/${roundId}/check-in`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        commandId: createId(),
        segmentId: createId(),
      }),
    }),
    roundId,
  );
  assert({
    given:
      'an authenticated member and a valid check-in for a nonexistent Round',
    should: 'map definite absence to 404 without a marker foreign-key failure',
    actual: response.status,
    expected: 404,
  });
});
