import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { collect, scriptedVoice, setup } from './operations.test-support';

setupRitewayBun();

describe('the AI speech, kept honest', () => {
  test('never voices or rewrites a line once its turn has passed', async () => {
    const { operations, begin, time, voice } = setup({
      personSide: 'negative',
    });
    const id = await begin();
    const events = await collect(
      operations.speech({ actorId: 'actor-1', id, turnIndex: 0 }),
    );
    const utteranceId = events[0]?.type === 'utterance' ? events[0].id : '';
    time.advance(10 + 300 + 4); // the AC is over, grace included
    const vendorCalls = voice.calls.length;
    await assertRejects({
      given: 'a request to voice a sentence of the AC after the AC',
      should: 'refuse with CONFLICT and never call the voice vendor',
      actual: () =>
        operations.speak({
          actorId: 'actor-1',
          id,
          utteranceId,
          sentenceIndex: 0,
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a request to cut the AC down to what was heard, after the AC',
      should: 'refuse with CONFLICT',
      actual: () =>
        operations.heard({
          actorId: 'actor-1',
          id,
          utteranceId,
          sentenceIndex: 0,
          playedMs: 0,
          totalMs: 1000,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'both refusals',
      should: 'reach no vendor',
      actual: voice.calls.length,
      expected: vendorCalls,
    });
  });

  test('a speech cut off by a vendor failure is written again, not replayed', async () => {
    const base = scriptedVoice();
    let failNext = true;
    const voice = {
      ...base,
      async *stream(request: Parameters<typeof base.stream>[0]) {
        if (failNext) {
          failNext = false;
          yield 'Thank you, judge. My first';
          throw createAppError('INFRASTRUCTURE', 'vendor down');
        }
        yield* base.stream(request);
      },
    };
    const { operations, begin } = setup({ personSide: 'negative', voice });
    const id = await begin();
    await assertRejects({
      given: 'the model failing halfway through the AC',
      should: 'reject the speech',
      actual: () =>
        collect(operations.speech({ actorId: 'actor-1', id, turnIndex: 0 })),
      code: 'INFRASTRUCTURE',
    });
    const retried = await collect(
      operations.speech({ actorId: 'actor-1', id, turnIndex: 0 }),
    );
    assert({
      given: 'the same speech asked for again',
      should: 'write the whole speech anew rather than replay the fragment',
      actual: retried
        .filter((e) => e.type === 'sentence')
        .map((e) => e.type === 'sentence' && e.text),
      expected: [
        'Thank you, judge.',
        'My first contention is safety.',
        'I urge an affirmative ballot.',
      ],
    });
  });

  test('a speech whose listener leaves stops asking the model', async () => {
    const { operations, begin, voice } = setup({ personSide: 'negative' });
    const id = await begin();
    const leaving = new AbortController();
    const events = operations.speech({
      actorId: 'actor-1',
      id,
      turnIndex: 0,
      signal: leaving.signal,
    });
    await events.next(); // the line
    await events.next(); // its first sentence: the model is streaming
    leaving.abort();
    await events.return(undefined);
    assert({
      given: 'a listener that leaves after the first event',
      should: 'pass its signal to the model stream, which sees it aborted',
      actual: voice.signals.at(-1)?.aborted,
      expected: true,
    });
  });
});
