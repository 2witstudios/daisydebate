import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createRoundHandlers } from './handlers';
setupRitewayBun();
const id = 'a'.repeat(24),
  origin = 'http://localhost:3000';
const envelope = {
  version: 1,
  commandId: id,
  expectedVersion: 1,
  command: { type: 'start' },
};
const fixture = () => {
  let calls = 0;
  const handlers = createRoundHandlers({
    logger: silentLogger,
    identify: async () => ({
      state: 'member',
      username: 'Member',
      principal: { kind: 'user', userId: id, actorId: id },
    }),
    origin: () => origin,
    getActorByUserId: async () => ({ id }),
    limiter: () => ({
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    }),
    limits: {
      read: { max: 10, windowSeconds: 60 },
      command: { max: 10, windowSeconds: 60 },
    },
    active: () => true,
    maxBodyBytes: 4096,
    operations: {
      command: async () => {
        calls++;
        return {
          commandId: id,
          roundId: id,
          resultingVersion: 2,
          replayed: false,
        };
      },
    },
    view: async () => ({ id, version: 2 }) as never,
    utterances: async () => [],
  });
  return { handlers, calls: () => calls };
};
test('shared boundary refuses actor claims and foreign origins before mutation', async () => {
  const f = fixture();
  const statuses = [];
  for (const [body, suppliedOrigin] of [
    [{ ...envelope, actorId: id }, origin],
    [envelope, 'https://foreign.invalid'],
  ] as const)
    statuses.push(
      (
        await f.handlers.commands(
          new Request(`${origin}/api/rounds/${id}/commands`, {
            method: 'POST',
            headers: {
              origin: suppliedOrigin,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
          id,
        )
      ).status,
    );
  assert({
    given: 'claimed actor and foreign Origin',
    should: 'refuse both before operations',
    actual: { statuses, calls: f.calls() },
    expected: { statuses: [400, 403], calls: 0 },
  });
});
test('native POST uses the same command gates and redirects without submitted values', async () => {
  const f = fixture();
  const response = await f.handlers.commands(
    new Request(`${origin}/api/rounds/${id}/commands`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        version: '1',
        commandId: id,
        expectedVersion: '1',
        type: 'start',
      }),
    }),
    id,
  );
  assert({
    given: 'a native HTML form POST',
    should: 'commit through the shared operation and move to its Round receipt',
    actual: {
      status: response.status,
      location: response.headers.get('location'),
      calls: f.calls(),
    },
    expected: { status: 303, location: `/rounds/${id}`, calls: 1 },
  });
});
