import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestApp, origin } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

setupRitewayBun();
requireTestServices(process.env);

test('attendance enforces the real Redis member budget across nonexistent rounds', async () => {
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
  const statuses = [];
  for (let index = 0; index < 121; index++) {
    const roundId = createId();
    const response = await app.routes.attendance.checkIn(
      new Request(`${origin}/api/rounds/${roundId}/check-in`, {
        method: 'POST',
        headers: {
          origin,
          cookie: signed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          commandId: createId(),
          segmentId: createId(),
        }),
      }),
      roundId,
    );
    statuses.push(response.status);
  }
  assert({
    given: 'one real member checking into 121 different nonexistent rounds',
    should: 'spend one shared Redis budget and refuse request 121',
    actual: statuses,
    expected: [...Array<number>(120).fill(404), 429],
  });
});
