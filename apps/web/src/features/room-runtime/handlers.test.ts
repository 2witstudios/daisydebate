import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createRoomHandlers } from './handlers';
import type { RoomRuntimeOperations } from './operations';
import { silentLogger } from '../../server/test-loggers.test-support';
setupRitewayBun();
const origin = 'http://localhost:3000';
const id = 'abcdefghijklmnopqrstuvwx';
const member: Identity = {
  state: 'member',
  username: 'Member',
  principal: { kind: 'user', userId: id, actorId: id },
};
test('canonical Room handler refuses origin, identity and claimed principal before operations', async () => {
  let calls = 0;
  const run = async (
    identity: Identity,
    suppliedOrigin: string,
    body: unknown,
  ) => {
    const handlers = createRoomHandlers({
      logger: silentLogger,
      origin: () => origin,
      identify: async () => identity,
      getActorByUserId: async () => ({ id }),
      operations: {
        command: async () => {
          calls++;
          return {} as never;
        },
      } as unknown as RoomRuntimeOperations,
      active: () => true,
      maxBodyBytes: 4096,
      limiter: () => ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }),
      limits: {
        create: { max: 10, windowSeconds: 60 },
        read: { max: 10, windowSeconds: 60 },
        command: { max: 10, windowSeconds: 60 },
      },
    });
    return (
      await handlers.commands(
        new Request(`${origin}/api/rooms/${id}/commands`, {
          method: 'POST',
          headers: {
            origin: suppliedOrigin,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        id,
      )
    ).status;
  };
  const body = {
    commandId: id,
    expectedVersion: 1,
    expectedConsentVersion: 0,
    type: 'ready',
  };
  const statuses = [
    await run(member, 'https://foreign.invalid', body),
    await run(
      { state: 'anonymous', principal: { kind: 'anonymous' } },
      origin,
      body,
    ),
    await run(member, origin, { ...body, actorId: id }),
  ];
  assert({
    given: 'foreign Origin, anonymous session and acting actor claim',
    should: 'refuse each at the canonical boundary without mutation',
    actual: [statuses, calls],
    expected: [[403, 401, 400], 0],
  });
});
