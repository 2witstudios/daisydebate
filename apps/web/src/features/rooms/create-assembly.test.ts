import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot, rankedCreateForm } from './assembly.test-support';
import { createAssembly } from './create-assembly';

setupRitewayBun();
const form = () => rankedCreateForm();

test('create forwards the selected immutable revision and verifies the returned room identity', async () => {
  const calls: unknown[] = [];
  const result = await createAssembly(async (path, init) => {
    calls.push([path, init.method, JSON.parse(String(init.body))]);
    return Response.json(
      { receipt: { roomId: 'i'.repeat(24) }, view: assemblySnapshot },
      { status: 201 },
    );
  }, form());
  assert({
    given: 'a native create submission naming a stored ranked preset',
    should:
      'send the exact version and dedupe ID to canonical create and navigate only to the acknowledged Room',
    actual: [calls, result],
    expected: [
      [
        [
          '/api/rooms',
          'POST',
          {
            commandId: 'h'.repeat(24),
            title: 'My room',
            topic: 'A real topic',
            visibility: 'unlisted',
            selection: {
              kind: 'ranked',
              formatId: 'stored-format',
              formatVersion: 2,
              presetVersion: 3,
            },
          },
        ],
      ],
      { kind: 'created', roomId: 'i'.repeat(24) },
    ],
  });
});

test('invalid create selections refuse before transport; server refusals never become success', async () => {
  let calls = 0;
  const invalid = form();
  invalid.set('selection', '[broken');
  const badResult = await createAssembly(async () => {
    calls++;
    return new Response();
  }, invalid);
  const outcomes = [];
  const activeRoom = {
    version: 1,
    id: 'm'.repeat(24),
    title: 'Current room',
    phase: 'ready',
    role: 'debater',
    href: `/rooms/${'m'.repeat(24)}`,
  };
  for (const response of [
    new Response(null, { status: 403 }),
    new Response(null, { status: 409 }),
    new Response(null, { status: 429 }),
    new Response(null, { status: 400 }),
    new Response(null, { status: 404 }),
    Response.json({ refusal: 'active-room', activeRoom }, { status: 409 }),
    Response.json(
      { refusal: 'active-room', activeRoom: null },
      { status: 409 },
    ),
    Response.json(
      {
        receipt: { roomId: 'j'.repeat(24) },
        view: { ...assemblySnapshot, id: 'k'.repeat(24) },
      },
      { status: 201 },
    ),
  ]) {
    outcomes.push(await createAssembly(async () => response, form()));
  }
  assert({
    given:
      'malformed form JSON, forbidden, replayed, rate-limited, invalid and already-in-a-room creates, and inconsistent success identities',
    should:
      'make zero calls for invalid input and name each refusal truthfully',
    actual: [calls, badResult.kind, outcomes],
    expected: [
      0,
      'invalid',
      [
        { kind: 'refused', reason: 'forbidden' },
        { kind: 'refused', reason: 'replayed' },
        { kind: 'refused', reason: 'rate-limited' },
        { kind: 'refused', reason: 'settings' },
        { kind: 'unavailable' },
        { kind: 'active-room', href: activeRoom.href },
        { kind: 'active-room', href: null },
        { kind: 'unavailable' },
      ],
    ],
  });
});
