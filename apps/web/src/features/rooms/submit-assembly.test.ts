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
