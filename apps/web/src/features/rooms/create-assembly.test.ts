import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { createAssembly } from './create-assembly';

setupRitewayBun();
const form = () => {
  const fields = new FormData();
  fields.set('commandId', 'h'.repeat(24));
  fields.set('title', 'My room');
  fields.set('topic', 'A real topic');
  fields.set('visibility', 'unlisted');
  fields.set(
    'selection',
    JSON.stringify({
      kind: 'ranked',
      formatId: 'stored-format',
      formatVersion: 2,
      presetVersion: 3,
      length: 'full',
    }),
  );
  return fields;
};

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
              length: 'full',
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
  for (const response of [
    new Response(null, { status: 403 }),
    new Response(null, { status: 409 }),
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
      'malformed form JSON, forbidden/stale create and inconsistent success identities',
    should:
      'make zero calls for invalid input and retain truthful refusal/unavailable states',
    actual: [calls, badResult.kind, outcomes.map((result) => result.kind)],
    expected: [0, 'invalid', ['refused', 'refused', 'unavailable']],
  });
});
