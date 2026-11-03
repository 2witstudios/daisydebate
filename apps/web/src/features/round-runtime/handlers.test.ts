import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { memberGate } from './member-gate.test-support';
import { createRoundHandlers } from './handlers';
setupRitewayBun();
const id = 'a'.repeat(24),
  origin = 'http://localhost:3000';
const envelope = {
  version: 1,
  commandId: id,
  expectedVersion: 1,
  command: { type: 'yield', participantId: id },
};
const fixture = () => {
  let calls = 0;
  const handlers = createRoundHandlers({
    ...memberGate(id, origin),
    clock: fixedClock('2026-11-01T12:34:56.789Z'),
    websocketEndpoint: 'wss://socket.daisy.invalid/realtime',
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
    view: async () =>
      ({
        id,
        version: 2,
        participants: [{ id: 'seat' }],
        segments: [{ id: 'segment' }],
      }) as never,
    transcript: async (_caller: unknown, roundId: string) => ({ roundId }),
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
test('the command route takes only the JSON envelope; no form-encoded side door skips confirmation', async () => {
  const f = fixture();
  const response = await f.handlers.commands(
    new Request(`${origin}/api/rounds/${id}/commands`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        version: '1',
        commandId: id,
        expectedVersion: '1',
        type: 'forfeit',
        participantId: id,
      }),
    }),
    id,
  );
  assert({
    given: 'a form-encoded forfeit POST without the confirmation step',
    should: 'refuse it before any operation runs',
    actual: { status: response.status, calls: f.calls() },
    expected: { status: 400, calls: 0 },
  });
});

test('Round reads return only their slice of the viewer projection', async () => {
  const f = fixture();
  const get = (path: string) => new Request(`${origin}${path}`);
  const [utterances, malformed] = await Promise.all([
    f.handlers.transcript(get(`/api/rounds/${id}/transcript`), id),
    f.handlers.transcript(get('/api/rounds/x/transcript'), 'x'),
  ]);
  assert({
    given: 'a member reading utterances and a malformed segment',
    should: 'pass the validated id through and refuse the malformed id',
    actual: [await utterances.json(), malformed.status, f.calls()],
    expected: [{ roundId: id }, 400, 0],
  });
});

const roundRead = () =>
  new Request(`${origin}/api/rounds/${id}`, { headers: { origin } });

test('a Round read stamps its clock and names its doorbell', async () => {
  const response = await fixture().handlers.read(roundRead(), id);
  assert({
    given: 'a canonical authorized Round read',
    should: 'return the injected server instant and the realtime endpoint',
    actual: [
      response.status,
      response.headers.get('x-server-now-ms'),
      response.headers.get('x-realtime-socket-url'),
    ],
    expected: [
      200,
      String(Date.parse('2026-11-01T12:34:56.789Z')),
      'wss://socket.daisy.invalid/realtime',
    ],
  });
});

test('a Round read spends the Round view budget, not a Room or transcript one', async () => {
  const keys: string[] = [];
  const handlers = createRoundHandlers({
    ...memberGate(id, origin),
    clock: fixedClock('2026-11-01T12:34:56.789Z'),
    limiter: () => ({
      consume: async (key) => {
        keys.push(key);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    }),
    operations: { command: async () => ({}) as never },
    view: async () => ({ id }) as never,
    transcript: async () => ({}),
  });
  await handlers.read(roundRead(), id);
  await handlers.transcript(roundRead(), id);
  assert({
    given: 'a Round read and a transcript read by one member',
    should: 'spend separate buckets',
    actual: keys,
    expected: [`round-member:view:${id}`, `round-member:read:${id}`],
  });
});
