import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema, type RoomView } from '@daisy/protocol';
import { createRoutes } from '../src/server/routes';
import { inProcessFetch } from '../src/server/in-process-fetch';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { createTestApp } from './fixtures';
export function createRoomHttpFixture() {
  // Explicit env policy through ordinary createApp; no injection/adoption.
  const f = createTestApp({
    ROOM_POLICY: JSON.stringify({
      consentTtlMs: 60_000,
      maxOpenRooms: 5,
      maxBodyBytes: 262_144,
      limits: {
        create: { max: 20, windowSeconds: 60 },
        read: { max: 200, windowSeconds: 60 },
        command: { max: 200, windowSeconds: 60 },
      },
    }),
  });
  const account = createAccountFlows(f);
  const routes = createRoutes(f.app);
  const headers = (cookie: string) =>
    new Headers({
      cookie,
      origin: f.origin,
      'content-type': 'application/json',
    });
  const member = async () => {
    const signed = await account.signUp();
    const response = await account.claim(signed.cookie, {
      username: uniqueName(),
    });
    if (response.status !== 201)
      throw new Error('Fixture membership claim failed');
    return signed.cookie;
  };
  const command = async (cookie: string, view: RoomView, body: object) => {
    const response = await inProcessFetch(
      (request) => routes.rooms.commands(request, view.id),
      headers(cookie),
    )(`/api/rooms/${view.id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        commandId: createId(),
        expectedVersion: view.version,
      }),
    });
    if (response.status !== 200)
      throw new Error(
        `Fixture accepted Room command returned ${response.status}`,
      );
    return roomViewSchema.parse((await response.json()).view);
  };
  return { f, routes, headers, member, command };
}
