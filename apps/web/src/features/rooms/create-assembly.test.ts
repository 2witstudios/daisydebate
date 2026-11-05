import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot, rankedCreateForm } from './assembly.test-support';
import { createAssembly } from './create-assembly';

setupRitewayBun();
const form = () => rankedCreateForm();

test('an unavailable ranked season is not mistaken for an already submitted form', async () => {
  const result = await createAssembly(
    async () =>
      Response.json({ refusal: 'ranked-unavailable' }, { status: 409 }),
    form(),
  );
  assert({
    given: 'a valid Ranked request while no season is active',
    should: 'identify temporary Ranked unavailability',
    actual: result,
    expected: { kind: 'refused', reason: 'ranked-unavailable' },
  });
});

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
            resolution: { kind: 'custom', text: 'A real topic' },
            visibility: 'public',
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

test('the notice a ranked form showed travels with its create', async () => {
  const fields = rankedCreateForm('public');
  fields.set('noticeVersion', 'ranked-draft-2');
  let sent: unknown;
  await createAssembly(async (_url, init) => {
    sent = JSON.parse(String(init.body));
    return Response.json(
      { receipt: { roomId: 'i'.repeat(24) } },
      { status: 201 },
    );
  }, fields);
  assert({
    given: 'a form carrying the notice version it rendered',
    should: 'state it to the server',
    actual: (sent as { noticeVersion?: string }).noticeVersion,
    expected: 'ranked-draft-2',
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
    seated: true,
    href: `/rooms/${'m'.repeat(24)}`,
  };
  for (const response of [
    new Response(null, { status: 403 }),
    Response.json({ refusal: 'command-conflict' }, { status: 409 }),
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
        { kind: 'refused', reason: 'settings' },
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

test('a striking format leaves the resolution empty; its refusals name the settings (PR #472 review)', async () => {
  const posted: unknown[] = [];
  const empty = form();
  empty.set('resolutionMethod', 'strike');
  await createAssembly(async (_path, init) => {
    posted.push(JSON.parse(String(init.body)).resolution);
    return Response.json(
      { receipt: { roomId: 'i'.repeat(24) }, view: assemblySnapshot },
      { status: 201 },
    );
  }, empty);
  const refused = async (refusal: string) =>
    createAssembly(
      async () => Response.json({ refusal }, { status: 409 }),
      form(),
    );
  assert({
    given:
      'an empty resolution, then a topic that does not fit the format and a catalog preset that moved on',
    should:
      'post no topic for the strike to fill, and explain both refusals as settings, never as a replay',
    actual: [
      posted,
      await refused('illegal-config'),
      await refused('format-unavailable'),
    ],
    expected: [
      [{ kind: 'strike' }],
      { kind: 'refused', reason: 'settings' },
      { kind: 'refused', reason: 'settings' },
    ],
  });
});

test('a casual recording choice reaches canonical creation; ranked stays automatic', async () => {
  const sent: Record<string, unknown>[] = [];
  for (const ranked of [false, true]) {
    const fields = form();
    fields.set('recording', 'on');
    if (!ranked) {
      fields.set('competition', 'casual');
      fields.set(
        'selection',
        JSON.stringify({
          kind: 'catalog',
          formatId: 'stored-format',
          formatVersion: 2,
          presetVersion: 3,
          competitionType: 'casual',
        }),
      );
    }
    await createAssembly(async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ refusal: 'capture-premium' }, { status: 409 });
    }, fields);
  }
  assert({
    given: 'a casual recording selection followed by a Ranked form',
    should: 'request recording only for casual, leaving Ranked automatic',
    actual: sent.map((body) => body.recording ?? null),
    expected: [true, null],
  });
});

test('recording subscription refusal stays actionable on creation', async () => {
  assert({
    given: 'canonical creation refusing a recording subscription',
    should: 'identify the capture entitlement refusal',
    actual: await createAssembly(
      async () =>
        Response.json({ refusal: 'capture-premium' }, { status: 409 }),
      form(),
    ),
    expected: { kind: 'refused', reason: 'capture-premium' },
  });
});
