import { assert, setupRitewayBun, test } from 'riteway/bun';
import { memberGate } from './member-gate.test-support';
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
    ...memberGate(id, origin),
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
  const [participants, segments, utterances, malformed] = await Promise.all([
    f.handlers.participants(get(`/api/rounds/${id}/participants`), id),
    f.handlers.segments(get(`/api/rounds/${id}/segments`), id),
    f.handlers.transcript(get(`/api/rounds/${id}/transcript`), id),
    f.handlers.transcript(get('/api/rounds/x/transcript'), 'x'),
  ]);
  assert({
    given:
      'a member reading participants, segments, utterances and a malformed segment',
    should:
      'answer each with its versioned slice, pass validated ids through, and refuse the malformed id',
    actual: [
      await participants.json(),
      await segments.json(),
      await utterances.json(),
      malformed.status,
      f.calls(),
    ],
    expected: [
      { roundId: id, version: 2, participants: [{ id: 'seat' }] },
      { roundId: id, version: 2, segments: [{ id: 'segment' }] },
      { roundId: id },
      400,
      0,
    ],
  });
});
