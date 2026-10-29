import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { silentLogger } from '../../server/test-loggers.test-support';
import { unequalTemplate } from './assembly.test-support';
import { createRoomDraft } from './create-room-draft';
import { changeDraftSchedule } from './prepare-room-draft';
import { draftFormValues } from './create-room-fields';
import { createRoomDraftHandler } from './create-room-draft-handler';
setupRitewayBun();
const origin = 'https://example.test';
const id = 'm'.repeat(24);
const member: Identity = {
  state: 'member',
  username: 'Member',
  principal: { kind: 'user', userId: id, actorId: id },
};
const dependencies = (identity: Identity = member) => ({
  logger: silentLogger,
  origin: () => origin,
  identify: async () => identity,
  limiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
  store: { setEphemeral: async () => {}, get: async () => null },
  catalog: async () =>
    Response.json({ choices: [unequalTemplate], resolutions: [], bots: [] }),
  create: async () => {
    throw new Error('A preview must not create');
  },
  rematch: async () => {
    throw new Error('A preview must not rematch');
  },
});

test('full native schedules cross the action cap through the bounded form route', async () => {
  let draft = createRoomDraft(unequalTemplate);
  for (let i = 2; i < 64; i++)
    draft = changeDraftSchedule(
      draft,
      i % 2 ? 'add-negative' : 'add-affirmative',
    );
  const form = new FormData();
  Object.entries(draftFormValues(draft)).forEach(([key, value]) =>
    form.set(key, value),
  );
  form.set('commandId', 'c'.repeat(24));
  form.set('intent', 'configure');
  form.set('title', 'Complete native schedule');
  const request = new Request(`${origin}/play/room/submit`, {
    method: 'POST',
    headers: { origin },
    body: form,
  });
  const size = (await request.clone().arrayBuffer()).byteLength;
  const saved: unknown[] = [];
  const handler = createRoomDraftHandler({
    ...dependencies(),
    store: {
      setEphemeral: async (_key, value, ttl) => {
        saved.push([JSON.parse(value).state.values.segmentCount, ttl]);
      },
      get: async () => null,
    },
  });
  const answer = await handler(request);
  assert({
    given: 'a 64-period native form larger than the global action cap',
    should:
      'retain every period in an expiring answer and redirect to the creator',
    actual: [
      size > 16384,
      size < 131072,
      answer.status,
      new URL(answer.headers.get('location')!, origin).pathname,
      saved,
    ],
    expected: [true, true, 303, '/play/room', [['64', 300]]],
  });
});

test('the form route refuses cross-origin, anonymous, oversized and malformed submissions before catalog reads', async () => {
  let calls = 0;
  const deps = {
    ...dependencies(),
    catalog: async () => {
      calls++;
      return new Response();
    },
  };
  const request = (body: string, suppliedOrigin = origin) =>
    new Request(`${origin}/play/room/submit`, {
      method: 'POST',
      headers: {
        origin: suppliedOrigin,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  const handler = createRoomDraftHandler(deps);
  const answers = await Promise.all([
    handler(request('commandId=invalid', 'https://other.test')),
    createRoomDraftHandler({
      ...deps,
      identify: async () => ({
        state: 'anonymous',
        principal: { kind: 'anonymous' },
      }),
    })(request('')),
    handler(request('x'.repeat(131073))),
    handler(request('commandId=invalid')),
    handler(
      new Request(`${origin}/play/room/submit`, {
        method: 'POST',
        headers: { origin, 'content-type': 'multipart/form-data' },
        body: 'broken',
      }),
    ),
  ]);
  assert({
    given: 'invalid callers and bodies',
    should: 'reject them at the trust boundary without reading the catalog',
    actual: [answers.map((answer) => answer.status), calls],
    expected: [[403, 401, 400, 400, 400], 0],
  });
});
