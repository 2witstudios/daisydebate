import { assert, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { twoSides } from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';
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
      { kind: 'missing' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
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
    opening: null,
    id,
    roomId: 'd'.repeat(24),
    version: 1,
    visibility: 'unlisted',
    startedAt: null,
    completedAt: null,
    outcome: null,
    panelRuling: null,
    platformEnding: null,
    postRoundCall: false,
    waitingOn: null,
    transcriptCompleteness: null,
    resolutionAudit: null,
    status: 'opening',
    ladder: null,
    competitionType: 'casual',
    topic: 'Frozen launch topic',
    participants: [
      {
        id: 'e'.repeat(24),
        actorId: 'f'.repeat(24),
        label: 'Second speaker',
        kind: 'human',
        seat: { kind: 'side', side: 'negative', slot: 2 } as const,
      },
    ],
    config: {
      preRoundPrep: { enabled: false },
      resolutionDraw: { enabled: false },
      inRoundPrep: { enabled: false },
      speechTiming: { countdownMs: 731, segmentDurationOverrides: {} },
      pointsOfInformation: null,
      yielding: null,
    },
    rules: {
      version: 3,
      sides: [...twoSides],
      seats: {
        sides: { affirmative: 2, negative: 3 },
        speakers: 0,
        judges: 1,
        moderators: 0,
      },
      outcome: { kind: 'winner' },
      segments: [
        {
          key: 'NR3',
          label: 'Third negative reply',
          type: 'speech',
          speak: {
            rights: 'one',
            seat: { kind: 'side', side: 'negative', slot: 2 },
          },
          durationMs: 223456,
        },
        {
          key: 'A1',
          label: 'Affirmative opening',
          type: 'speech',
          speak: {
            rights: 'one',
            seat: { kind: 'side', side: 'affirmative', slot: 0 },
          },
          durationMs: 60000,
        },
      ],
      inRoundPrep: null,
      countdownMs: 731,
      interaction: {
        yield: null,
        pointsOfInformation: { allowed: false as const },
      },
    },
    viewerIsHost: false,
    checkpoint: emptyRuntimeCheckpointFor({ sides: twoSides }),
    segments: [],
  } satisfies RoundView;
  const variants = [
    frozen,
    { ...frozen, id: 'g'.repeat(24) },
    {
      ...frozen,
      participants: [
        { ...frozen.participants[0], seat: { kind: 'not-a-seat', slot: 0 } },
      ],
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
      { kind: 'found', round: frozen, socketUrl: null },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('Round receipt says which unavailable answers are temporary', async () => {
  const read = (status: number, headers: HeadersInit = {}) =>
    readRoundReceipt(
      async () => new Response(null, { status, headers }),
      'a'.repeat(24),
    );
  assert({
    given: 'a 503 saying when to retry, a bare 503 and a 500',
    should: 'mark only the first temporary',
    actual: [
      await read(503, { 'retry-after': '1' }),
      await read(503),
      await read(500),
    ],
    expected: [
      { kind: 'unavailable', temporary: true },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});
