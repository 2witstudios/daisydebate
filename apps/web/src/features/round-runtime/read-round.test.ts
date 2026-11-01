import { assert, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type RoundView } from '@daisy/protocol';
import { readRoundReceipt } from './read-round';

setupRitewayBun();

test('Round receipt refuses non-success and malformed success responses', async () => {
  const outcomes = [];
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 403 }),
    Response.json({ topic: 'fabricated success' }),
    new Response('invalid json'),
  ])
    outcomes.push(await readRoundReceipt(async () => response, 'a'.repeat(24)));
  assert({
    given: 'missing, forbidden and corrupt Round reads',
    should: 'never turn them into a persisted receipt',
    actual: outcomes,
    expected: [
      { kind: 'missing', socketUrl: null },
      { kind: 'unavailable', socketUrl: null },
      { kind: 'unavailable', socketUrl: null },
      { kind: 'unavailable', socketUrl: null },
    ],
  });
});

test('Round receipt validates the ID before dispatch and uses the canonical GET', async () => {
  const calls: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    calls.push([path, init]);
    return new Response(null, { status: 404 });
  };
  await readRoundReceipt(fetch, '../../escape');
  await readRoundReceipt(fetch, 'b'.repeat(24));
  assert({
    given: 'an invalid path then a canonical Round ID',
    should:
      'refuse the invalid ID locally and send only the valid authenticated read',
    actual: calls,
    expected: [[`/api/rounds/${'b'.repeat(24)}`, { method: 'GET' }]],
  });
});

test('Round receipt accepts only the requested persisted identity and legal frozen rules', async () => {
  const id = 'c'.repeat(24);
  const frozen = {
    id,
    roomId: 'd'.repeat(24),
    version: 1,
    visibility: 'unlisted',
    startedAt: null,
    completedAt: null,
    outcome: null,
    unjudgedRuling: null,
    resolutionAudit: null,
    status: 'scheduled',
    ladderId: null,
    competitionType: 'casual',
    topic: 'Frozen launch topic',
    participants: [
      {
        id: 'e'.repeat(24),
        actorId: 'f'.repeat(24),
        label: 'Second speaker',
        kind: 'human',
        role: 'negative',
        slot: 2,
      },
    ],
    config: {
      preRoundPrep: { enabled: false },
      resolutionDraw: { enabled: false },
      inRoundPrep: { enabled: false },
      speechTiming: { countdownMs: 731, segmentDurationOverrides: {} },
      crossExamination: { crossExMode: 'ordered' },
      interruptions: null,
      yielding: null,
    },
    rules: {
      version: 2,
      seats: { affirmative: 2, negative: 3, judge: 1 },
      segments: [
        {
          key: 'NR3',
          label: 'Third negative reply',
          type: 'speech',
          side: 'negative',
          slot: 2,
          durationMs: 223456,
        },
        {
          key: 'A1',
          label: 'Affirmative opening',
          type: 'speech',
          side: 'affirmative',
          slot: 0,
          durationMs: 60000,
        },
      ],
      inRoundPrep: null,
      countdownMs: 731,
      interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
    },
    viewerIsHost: false,
    checkpoint: emptyRuntimeCheckpoint,
    segments: [],
  } satisfies RoundView;
  const withSample = await readRoundReceipt(
    async () =>
      Response.json(frozen, {
        headers: { 'x-server-now-ms': '1730000000000' },
      }),
    id,
  );
  if (withSample.kind !== 'found' || withSample.serverNowMs === null)
    throw new Error('expected the authorized sample');
  assert({
    given: 'an authorized read reporting an explicit server instant',
    should: 'carry the server clock millisecond instant verbatim',
    actual: [withSample.serverNowMs, Number.isFinite(withSample.serverNowMs)],
    expected: [1730000000000, true],
  });
  const variants = [
    frozen,
    { ...frozen, id: 'g'.repeat(24) },
    {
      ...frozen,
      participants: [{ ...frozen.participants[0], role: 'spectator' }],
    },
  ];
  const results = [];
  for (const body of variants)
    results.push(await readRoundReceipt(async () => Response.json(body), id));
  assert({
    given:
      'a valid frozen projection, a mismatched ID and an invalid cast role',
    should:
      'preserve the valid persisted fields and refuse substitution or malformed cast',
    actual: results,
    expected: [
      { kind: 'found', round: frozen, serverNowMs: null, socketUrl: null },
      { kind: 'unavailable', socketUrl: null },
      { kind: 'unavailable', socketUrl: null },
    ],
  });
});

test('the browser measures around the complete authorized reader, not its server process epoch', async () => {
  const { round } = await import('../room-runtime/operations.test-support');
  const { createMeasuredRead, createRoundTime } = await import('./round-time');
  let clientMono = 1000;
  const clock = createRoundTime({ monotonicNowMs: () => clientMono });
  const gate = Promise.withResolvers<void>();
  const read = createMeasuredRead({
    read: () =>
      readRoundReceipt(async () => {
        await gate.promise;
        return Response.json(round, {
          headers: { 'x-server-now-ms': '90000' },
        });
      }, round.id),
    roundTime: clock,
    monotonicNowMs: () => clientMono,
    nextGeneration: () => 1,
  });
  const pending = read();
  clientMono = 1200;
  gate.resolve();
  const response = await pending;
  assert({
    given:
      'a server-action-shaped complete reader whose server epoch never crosses the wire',
    should: 'carry only serverNowMs and calibrate with client1000..1200',
    actual: [
      response.kind === 'found' ? Object.keys(response).sort() : [],
      clock.calibration()?.serverAtReceiveMs,
      clock.calibration()?.monoAtReceiveMs,
    ],
    expected: [['kind', 'round', 'serverNowMs', 'socketUrl'], 90100, 1200],
  });
});
