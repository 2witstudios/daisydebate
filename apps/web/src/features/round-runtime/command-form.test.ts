import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitRoundForm } from './command-form';
import { roundCommandFields } from './command-fields';
import { view, aff } from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();
const commandId = 'c'.repeat(24);
const formOf = (type = 'yield') => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    version: '1',
    commandId,
    expectedVersion: String(view.version),
    type,
    participantId: aff.id,
  }))
    form.set(key, value);
  return form;
};
test('Round command form confirms yield and preserves its principal-free envelope across lost responses', async () => {
  const form = formOf();
  let calls = 0;
  const bodies: string[] = [];
  const send = async (_url: string, init: RequestInit) => {
    calls++;
    bodies.push(String(init.body));
    throw new Error('lost response');
  };
  const confirmation = await submitRoundForm(send, view.id, form);
  assert({
    given: 'the first End speech press',
    should: 'ask for confirmation without mutating the server',
    actual: { calls, confirmation: confirmation.confirmation },
    expected: { calls: 0, confirmation: true },
  });
  form.set('confirmed', 'true');
  const missing = await submitRoundForm(send, view.id, form);
  const retry = new FormData();
  for (const [k, v] of Object.entries(missing.values)) retry.set(k, v);
  await submitRoundForm(send, view.id, retry);
  assert({
    given: 'two unacknowledged attempts',
    should:
      'retain exactly the same command id, expected version and seat without an actor claim',
    actual: {
      same: bodies[0] === bodies[1],
      body: JSON.parse(bodies[0]!),
      values: missing.values.commandId,
    },
    expected: {
      same: true,
      body: {
        version: 1,
        commandId,
        expectedVersion: view.version,
        command: { type: 'yield', participantId: aff.id },
      },
      values: commandId,
    },
  });
});
test('Round form accepts only its own receipt and current canonical view', async () => {
  const form = formOf('interrupt');
  const response = (changes: Record<string, unknown> = {}) =>
    Response.json({
      receipt: {
        commandId,
        roundId: view.id,
        resultingVersion: view.version,
        replayed: false,
        ...changes,
      },
      view,
    });
  const accepted = await submitRoundForm(async () => response(), view.id, form);
  const foreign = await submitRoundForm(
    async () => response({ roundId: 'x'.repeat(24) }),
    view.id,
    form,
  );
  const unavailable = await submitRoundForm(
    async () => new Response(null, { status: 503 }),
    view.id,
    form,
  );
  assert({
    given: 'matching receipt, foreign receipt and unknown503 outcome',
    should:
      'adopt only an acknowledged matching projection and keep unknown retries intact',
    actual: {
      accepted: accepted.acknowledged,
      foreign: foreign.acknowledged,
      unknownId: unavailable.values.commandId,
    },
    expected: { accepted: true, foreign: undefined, unknownId: commandId },
  });
  const refused = await submitRoundForm(
    async () => new Response(null, { status: 409 }),
    view.id,
    form,
  );
  assert({
    given: 'a definitive stale-version refusal',
    should:
      'permit a new intent from the fresh reread instead of replaying an obsolete envelope',
    actual: refused.values,
    expected: {},
  });
});
test('flat command fields reject duplicates, claimed actors and fractional versions', () => {
  const entries = [...formOf('interrupt')];
  const bad = [
    [...entries, ['actorId', aff.actorId]],
    [...entries, ['type', 'yield']],
    entries.map(([k, v]) => [k, k === 'expectedVersion' ? '1.5' : v]),
  ];
  assert({
    given: 'invalid form encodings',
    should: 'refuse before the shared command boundary',
    actual: bad.map(
      (e) => roundCommandFields(e as [string, unknown][]) === null,
    ),
    expected: [true, true, true],
  });
});
