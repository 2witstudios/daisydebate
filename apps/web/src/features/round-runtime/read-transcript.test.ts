import { assert, setupRitewayBun, test } from 'riteway/bun';
import { round } from './round.test-support';
import { readTranscript } from './read-transcript';
setupRitewayBun();
test('protected transcript reads validate identity and clear denied access', async () => {
  const value = {
    contractVersion: 1,
    round,
    revision: 0,
    freeze: null,
    streams: [],
    utterances: [],
  };
  const outcomes = [];
  for (const response of [
    Response.json(value),
    Response.json({ ...value, round: { ...round, id: 'x'.repeat(24) } }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 503 }),
    Response.json({ ...value, streams: [{ state: 'invented' }] }),
  ]) {
    outcomes.push((await readTranscript(async () => response, round.id)).kind);
  }
  assert({
    given: 'valid, foreign, denied, unavailable and corrupt transcript reads',
    should:
      'adopt only the requested validated snapshot and discard denied access',
    actual: outcomes,
    expected: ['found', 'unavailable', 'missing', 'unavailable', 'unavailable'],
  });
});

test('an open tab reads through any added field, even in the Round view', async () => {
  const good = {
    contractVersion: 1,
    round: { ...round, waitingOn: 'added' },
    revision: 3,
    added: 'top',
    freeze: null,
    streams: [
      {
        segmentId: round.segments[0]?.id ?? 's'.repeat(24),
        roundParticipantId: 'p'.repeat(24),
        state: 'open',
        gaps: [],
        added: 'stream',
      },
    ],
    utterances: [],
  };
  const read = await readTranscript(async () => Response.json(good), round.id);
  const raised = await readTranscript(
    async () => Response.json({ ...good, contractVersion: 2 }),
    round.id,
  );
  assert({
    given: 'fields this build has never seen, then a raised contract version',
    should: 'keep reading through the first and ask for a reload on the second',
    actual: [read.kind, raised],
    expected: ['found', { kind: 'unavailable', outdated: true }],
  });
});

test('only a reply in another shape is outdated', async () => {
  const reply = (body: unknown) => async () => Response.json(body);
  assert({
    given: 'a corrupt shape, then a foreign Round in a good shape',
    should: 'flag the shape alone',
    actual: [
      await readTranscript(reply({ added: 'field' }), round.id),
      await readTranscript(
        reply({
          contractVersion: 1,
          round: { ...round, id: 'x'.repeat(24) },
          revision: 0,
          freeze: null,
          streams: [],
          utterances: [],
        }),
        round.id,
      ),
    ],
    expected: [
      { kind: 'unavailable', outdated: true },
      { kind: 'unavailable' },
    ],
  });
});

test('only an authorization answer clears the transcript', async () => {
  const answering = (status: number) => async () =>
    new Response('x', { status });
  const kinds = [];
  for (const status of [401, 403, 404, 500, 502, 503])
    kinds.push([
      status,
      (await readTranscript(answering(status), round.id)).kind,
    ]);
  const down = await readTranscript(async () => {
    throw new Error('connection refused');
  }, round.id);
  assert({
    given: 'refusals, server failures and a failed connection',
    should: 'read refusals as missing and everything else as unavailable',
    actual: [...kinds, down.kind],
    expected: [
      [401, 'missing'],
      [403, 'missing'],
      [404, 'missing'],
      [500, 'unavailable'],
      [502, 'unavailable'],
      [503, 'unavailable'],
      'unavailable',
    ],
  });
});

test('a read that never answers gives up rather than holding the sync', async () => {
  let signal: AbortSignal | null | undefined;
  const deadline = new AbortController();
  const read = readTranscript(
    (_url, init) => {
      signal = init.signal;
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    },
    round.id,
    deadline.signal,
  );
  deadline.abort();
  assert({
    given: 'a fetch left hanging with a deadline',
    should: 'pass the deadline and answer unavailable when it passes',
    actual: [(await read).kind, signal?.aborted],
    expected: ['unavailable', true],
  });
});
