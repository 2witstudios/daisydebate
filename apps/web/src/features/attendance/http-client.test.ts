import { assert, setupRitewayBun, test } from 'riteway/bun';
import { round } from '../room-runtime/operations.test-support';
import { createAttendanceHttpClient } from './http-client';
setupRitewayBun();
const command = { commandId: 'c'.repeat(24), segmentId: 's'.repeat(24) };
const receipt = {
  version: 1,
  roundId: round.id,
  ...command,
  participantId: 'p'.repeat(24),
  receivedAt: '2026-10-22T00:00:00.000001Z',
  resultingVersion: 1,
  replayed: false,
};

test('attendance HTTP reads canonical actual rows and rejects a foreign or refused snapshot', async () => {
  let body: unknown = round;
  let status = 200;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport = createAttendanceHttpClient({
    roundId: round.id,
    timeout: () => new AbortController().signal,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(body, { status });
    },
  });
  const own = await transport.read();
  body = { ...round, id: 'f'.repeat(24) };
  const foreign = await transport.read();
  status = 403;
  const refused = await transport.read();
  assert({
    given: 'a normal member GET with canonical, foreign then refused replies',
    should: 'adopt only the actual scoped Round without cache or mutation',
    actual: {
      own,
      foreign,
      refused,
      requests: calls.map((call) => [
        call.url,
        call.init.cache,
        call.init.body ?? null,
        call.init.credentials,
      ]),
    },
    expected: {
      own: round,
      foreign: null,
      refused: null,
      requests: Array.from({ length: 3 }, () => [
        `/api/rounds/${round.id}`,
        'no-store',
        null,
        'same-origin',
      ]),
    },
  });
});

test('receipt transport validates acknowledgements and bounds both discovery and check-in waits', async () => {
  let body: unknown = receipt;
  let status = 200;
  const budgets: number[] = [];
  const signals: AbortSignal[] = [];
  const transport = createAttendanceHttpClient({
    roundId: round.id,
    timeout: (ms) => {
      budgets.push(ms);
      return new AbortController().signal;
    },
    fetch: async (_url, init) => {
      signals.push(init.signal!);
      return Response.json(body, { status });
    },
  });
  const accepted = await transport.send(command);
  body = { ...receipt, commandId: 'f'.repeat(24) };
  const foreign = await transport.send(command);
  body = { refusal: 'command-conflict' };
  status = 409;
  const unknown = await transport.send(command);
  body = { refusal: 'attendance-finalized' };
  const closed = await transport.send(command);
  body = round;
  status = 200;
  await transport.read();
  assert({
    given:
      'an exact receipt, mismatched acknowledgement, unknown conflict and typed closed window',
    should:
      'accept exact authority only, retain unknown retry, retire closure and bound every HTTP wait',
    actual: {
      answers: [accepted, foreign, unknown, closed],
      budgets,
      signals: signals.every((signal) => signal instanceof AbortSignal),
    },
    expected: {
      answers: [true, false, false, 'closed'],
      budgets: [2000, 2000, 2000, 2000, 2000],
      signals: true,
    },
  });
});
