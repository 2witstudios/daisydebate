import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { createTestApp } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();
const rule = { max: 1, windowSeconds: 47 };
const f = createTestApp({
  ROOM_POLICY: JSON.stringify({
    consentTtlMs: 12345,
    maxOpenRooms: 7,
    maxBodyBytes: 54321,
    limits: { create: rule, read: rule, command: rule },
  }),
});
test('ordinary configured app enforces each canonical per-member rate budget', async () => {
  const account = createAccountFlows(f);
  const signed = await account.signUp();
  const claim = await account.claim(signed.cookie, { username: uniqueName() });
  if (claim.status !== 201) throw new Error('Fixture membership claim failed');
  const headers = { cookie: signed.cookie, origin: f.origin };
  const roomId = createId();
  const calls = [
    () =>
      f.routes.rooms.catalog(
        new Request(`${f.origin}/api/rooms/catalog`, { headers }),
      ),
    () => f.routes.rooms.create(f.jsonPost('/api/rooms', {}, headers)),
    () =>
      f.routes.rooms.commands(
        f.jsonPost(`/api/rooms/${roomId}/commands`, {}, headers),
        roomId,
      ),
  ];
  const statuses: number[][] = [];
  for (const call of calls)
    statuses.push([(await call()).status, (await call()).status]);
  assert({
    given:
      'ordinary createApp configured solely via env with one request per operation window',
    should:
      'apply independent canonical read/create/command limits before operation validation',
    actual: statuses,
    expected: [
      [200, 429],
      [400, 429],
      [400, 429],
    ],
  });
});
