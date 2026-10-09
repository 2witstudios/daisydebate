import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from './assembly.test-support';
import { readRoomTemplates } from './read-catalog';

setupRitewayBun();

test('catalog unavailability stays distinct from an authoritative empty list', async () => {
  const results = [];
  for (const response of [
    Response.json({ choices: [], bots: [] }),
    new Response(null, { status: 404 }),
    Response.json({ choices: [{ label: 'Invented' }] }),
    new Response('bad json'),
  ]) {
    results.push(await readRoomTemplates(async () => response));
  }
  assert({
    given: 'empty, inactive and corrupt catalog responses',
    should:
      'enable no invented template and preserve an explicit unavailable state',
    actual: results,
    expected: [
      { kind: 'found', choices: [], bots: [] },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('catalog retains exact template revisions, unequal seat counts and producer defaults', async () => {
  const result = await readRoomTemplates(async () =>
    Response.json({ choices: [unequalTemplate], bots: [] }),
  );
  assert({
    given:
      'the stored template with unequal team seats and explicit default configuration',
    should: 'keep every rendered field without replacing the producer choices',
    actual: result,
    expected: { kind: 'found', choices: [unequalTemplate], bots: [] },
  });
});
