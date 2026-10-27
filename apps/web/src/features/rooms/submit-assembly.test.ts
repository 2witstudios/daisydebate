import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { submitAssembly } from './submit-assembly';

setupRitewayBun();
const readyForm = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    type: 'ready',
    commandId: 'r'.repeat(24),
    expectedVersion: '3',
    expectedConsentVersion: '5',
  }))
    form.set(key, value);
  return form;
};

test('native Ready preserves the rendered consent revision and assembly version', async () => {
  let sent: unknown;
  const result = await submitAssembly(
    async (path, init) => {
      sent = [path, JSON.parse(String(init.body))];
      return Response.json({ view: assemblySnapshot, receipt: {} });
    },
    assemblySnapshot.id,
    readyForm(),
  );
  assert({
    given:
      'a rendered Ready form at room revision three and consent revision five',
    should:
      'forward both fences and a dedupe ID, trusting only a full canonical response',
    actual: [sent, result],
    expected: [
      [
        `/api/rooms/${assemblySnapshot.id}/commands`,
        {
          type: 'ready',
          commandId: 'r'.repeat(24),
          expectedVersion: 3,
          expectedConsentVersion: 5,
        },
      ],
      { kind: 'accepted', view: assemblySnapshot },
    ],
  });
});

test('invalid intents refuse before transport and a version conflict is never restored as Ready', async () => {
  let calls = 0;
  const form = readyForm();
  form.set('actorId', 's'.repeat(24));
  const forged = await submitAssembly(
    async () => {
      calls++;
      return new Response();
    },
    assemblySnapshot.id,
    form,
  );
  const conflict = await submitAssembly(
    async () => Response.json({ refusal: 'version-conflict' }, { status: 409 }),
    assemblySnapshot.id,
    readyForm(),
  );
  assert({
    given:
      'an acting-principal field injected into Ready and a stale server refusal',
    should:
      'dispatch no forged command and retain an explicit conflict for reread',
    actual: [calls, forged, conflict],
    expected: [
      0,
      { kind: 'invalid' },
      { kind: 'refused', reason: 'version-conflict' },
    ],
  });
});

test('a native format choice posts its catalog tuple as select-format (FMT-3)', async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    type: 'select-format',
    intent: 'choose',
    commandId: 's'.repeat(24),
    expectedVersion: '3',
    format: JSON.stringify({
      formatId: 'policy',
      formatVersion: 1,
      presetVersion: 2,
    }),
  }))
    form.set(key, value);
  let sent: unknown;
  await submitAssembly(
    async (_path, init) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ view: assemblySnapshot, receipt: {} });
    },
    assemblySnapshot.id,
    form,
  );
  assert({
    given: 'a format radio whose value names one catalog tuple',
    should: 'spread the tuple into the command, never post the raw field',
    actual: sent,
    expected: {
      type: 'select-format',
      intent: 'choose',
      commandId: 's'.repeat(24),
      expectedVersion: 3,
      formatId: 'policy',
      formatVersion: 1,
      presetVersion: 2,
    },
  });
  const forged = new FormData();
  for (const [key, value] of form) forged.set(key, value);
  forged.set('format', JSON.stringify({ formatId: 'policy', type: 'close' }));
  const refused = await submitAssembly(
    async () => {
      throw new Error('must not send');
    },
    assemblySnapshot.id,
    forged,
  );
  assert({
    given: 'a format value carrying anything but the tuple',
    should: 'refuse it before transport',
    actual: refused,
    expected: { kind: 'invalid' },
  });
});
