import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
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
    id,
    roomId: 'd'.repeat(24),
    version: 1,
    visibility: 'unlisted',
    hostActorId: 'l'.repeat(24),
    startedAt: null,
    completedAt: null,
    outcome: null,
    status: 'scheduled',
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
      ],
      inRoundPrep: null,
      countdownMs: 731,
      interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
    },
  } satisfies RoundView;
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
      { kind: 'found', round: frozen },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});
