import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { openFirstCrossExamination, setup } from './operations.test-support';

setupRitewayBun();

for (const state of ['expired', 'completed', 'forfeit', 'grace'] as const) {
  test(`AI utterance access respects the ${state} window`, async () => {
    const { operations, begin, clock, store, calls } = setup();
    const id = await begin();
    await openFirstCrossExamination(operations, clock, id);
    const exchange = await operations.crossExamine({
      actorId: 'actor-1',
      id,
      segmentIndex: 1,
    });
    const utteranceId = exchange.reply!.utteranceId;
    const version = (await operations.view({ actorId: 'actor-1', id })).version;
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'yield', segmentIndex: 1 },
      expectedVersion: version,
    });
    if (state === 'expired') clock.advance(31);
    if (state === 'completed') {
      clock.advance(3_600);
      await operations.ballot({ actorId: 'actor-1', id });
    }
    if (state === 'forfeit') {
      const current = (await store.getRound(id))!;
      await operations.command({
        actorId: 'actor-1',
        id,
        command: { type: 'abort' },
        expectedVersion: current.version,
      });
    }
    const before = await store.listRoundUtterances(id);
    const used = calls.length;
    const input = { actorId: 'actor-1', id, utteranceId, phraseIndex: 0 };
    const speak = () => operations.speak(input);
    const heard = () =>
      operations.heard({ ...input, playedMs: 0, totalMs: 100 });
    if (state === 'grace') {
      await speak();
      await heard();
      assert({
        given: 'a playback cutoff just after the segment yields',
        should: 'retain the bounded finalization path',
        actual: (await store.listRoundUtterances(id))[0]?.text,
        expected: '',
      });
    } else {
      for (const operation of [speak, heard])
        await assertRejects({
          given: `an AI line in a ${state} round window`,
          should: 'refuse buying voice or rewriting the transcript',
          actual: operation,
          code: 'CONFLICT',
        });
      assert({
        given: 'both refused utterance operations',
        should: 'preserve the transcript and make no provider calls',
        actual: [await store.listRoundUtterances(id), calls.length],
        expected: [before, used],
      });
    }
  });
}
