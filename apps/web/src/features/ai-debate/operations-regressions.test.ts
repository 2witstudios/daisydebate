import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { positionOfView, uiStateOf } from './context';
import { setup } from './operations.test-support';

setupRitewayBun();

const actorId = 'actor-1';
const clip = {
  actorId,
  segmentIndex: 0,
  audioBase64: 'QUJDRA==',
  format: 'webm' as const,
};

test('a failed clock write stops a command and leaves the durable speech intact', async () => {
  const { operations, begin, clock, store } = setup();
  const id = await begin();
  clock.advance(11);
  const before = await operations.view({ actorId, id });
  const persisted = structuredClone(await store.getRound(id));
  const apply = store.applyRoundExecution;
  let fail = true;
  store.applyRoundExecution = async (input) => {
    if (input.command === null && fail) {
      fail = false;
      throw createAppError('INFRASTRUCTURE', 'Injected write failure');
    }
    await apply(input);
  };
  clock.advance(300);
  await assertRejects({
    given: 'speech expiry whose clock write rolls back',
    should: 'propagate the infrastructure failure before applying the abort',
    actual: () =>
      operations.command({
        actorId,
        id,
        command: { type: 'abort' },
        expectedVersion: before.version,
      }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the failed execution',
    should: 'leave the database version and speech unchanged',
    actual: await store.getRound(id),
    expected: persisted,
  });
  await operations.command({
    actorId,
    id,
    command: { type: 'abort' },
    expectedVersion: before.version,
  });
  assert({
    given: 'a successful retry after rehydrating the discarded tick',
    should: 'complete with no open speech',
    actual: (await store.getRound(id))?.segments.map(
      (row) => row.endedAt !== null,
    ),
    expected: [true],
  });
});

test('a conflicting tick is retried from durable rows', async () => {
  const { operations, begin, clock, store } = setup();
  const id = await begin();
  const apply = store.applyRoundExecution;
  let attempts = 0;
  store.applyRoundExecution = async (input) => {
    attempts += 1;
    if (attempts === 1) throw createAppError('CONFLICT');
    await apply(input);
  };
  clock.advance(11);
  const view = await operations.view({ actorId, id });
  assert({
    given: 'a tick loses its first version race',
    should: 'rehydrate and persist the opening before returning it',
    actual: [attempts, view.segments.length],
    expected: [2, 1],
  });
});

test('the recorder tail is accepted only inside a bounded finalization window', async () => {
  const { operations, begin, clock, calls } = setup();
  const id = await begin();
  clock.advance(311);
  await operations.transcribe({ ...clip, id });
  const view = await operations.view({ actorId, id });
  assert({
    given: 'a buffered clip arriving one second after AC expires',
    should: 'retain it on the closed AC row',
    actual: view.utterances.map((line) => [line.segmentIndex, line.text]),
    expected: [[0, 'I affirm.']],
  });
  clock.advance(30);
  await assertRejects({
    given: 'an upload outside the thirty second window',
    should: 'refuse before calling the provider',
    actual: () => operations.transcribe({ ...clip, id }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused late upload',
    should: 'make no extra transcription call',
    actual: calls.filter((call) => call === 'transcribe').length,
    expected: 1,
  });
});

test('a transcription admitted live survives closure while the provider works', async () => {
  const fixture = setup(undefined, async () => {
    fixture.clock.advance(2);
    await fixture.operations.view({ actorId, id });
    return { text: 'The final words.' };
  });
  const id = await fixture.begin();
  fixture.clock.advance(309);
  await fixture.operations.transcribe({ ...clip, id });
  assert({
    given: 'a live upload whose segment closes during transcription',
    should: 'persist its admitted words',
    actual: (await fixture.operations.view({ actorId, id })).utterances.map(
      (line) => line.text,
    ),
    expected: ['The final words.'],
  });
});

test('the browser carries a virtual close into its next countdown', async () => {
  const { operations, begin, clock } = setup();
  const id = await begin();
  clock.advance(11);
  const view = await operations.view({ actorId, id });
  const state = uiStateOf(positionOfView(view, view.startedAt! + 311_000));
  assert({
    given: 'the AC view virtually advanced into the CX1 gap',
    should: 'show nine seconds of countdown',
    actual: state,
    expected: { phase: 'countdown', segmentIndex: 1, remainingMs: 9_000 },
  });
  const ended = uiStateOf(positionOfView(view, view.startedAt! + 3_600_000));
  assert({
    given:
      'the final speech expires naturally while its durable interval stays open',
    should: 'end the UI and request a ballot',
    actual: ended,
    expected: { phase: 'ended' },
  });
});

test('a hydration tick does not waive a version changed by another command', async () => {
  const { operations, begin, clock, store } = setup();
  const id = await begin();
  clock.advance(11);
  const version = (await operations.view({ actorId, id })).version;
  const apply = store.applyRoundExecution;
  let race = true;
  let afterRival = await store.getRound(id);
  store.applyRoundExecution = async (input) => {
    await apply(input);
    if (race && input.command === null) {
      race = false;
      await operations.crossExamine({ actorId, id, segmentIndex: 1 });
      const rivalVersion = (await store.getRound(id))!.version;
      await operations.command({
        actorId,
        id,
        command: { type: 'yield' },
        expectedVersion: rivalVersion,
      });
      afterRival = structuredClone(await store.getRound(id));
    }
  };
  clock.advance(310);
  await assertRejects({
    given: 'version 3, a hydration tick to 4 and a concurrent CX yield to 5',
    should: 'refuse the stale abort instead of committing version 6',
    actual: () =>
      operations.command({
        actorId,
        id,
        command: { type: 'abort' },
        expectedVersion: version,
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the rejected stale command',
    should: 'preserve the competing command’s round',
    actual: await store.getRound(id),
    expected: afterRival,
  });
});
