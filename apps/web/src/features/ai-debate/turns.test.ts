import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  collect,
  scriptedVoice,
  setup,
  withSpokenAc,
} from './operations.test-support';

setupRitewayBun();

describe('the AI speech', () => {
  test('streams sentences, saves them and voices one sentence', async () => {
    const { operations, id, store, voice, events, utteranceId } =
      await withSpokenAc();
    assert({
      given: 'the countdown into the AC with the AI on the affirmative',
      should:
        'write the speech early, emitting the utterance and each sentence in order',
      actual: events
        .filter((e) => e.type === 'sentence')
        .map((e) => e.type === 'sentence' && e.text),
      expected: [
        'Thank you, judge.',
        'My first contention is safety.',
        'I urge an affirmative ballot.',
      ],
    });
    assert({
      given: 'the finished speech',
      should:
        'save it as the AI line for the turn and start counting the debate',
      actual: {
        text: store.records.get(id)?.utterances[0]?.text,
        counted: store.records.get(id)?.countedAt !== null,
      },
      expected: {
        text: 'Thank you, judge. My first contention is safety. I urge an affirmative ballot.',
        counted: true,
      },
    });
    const audio = await operations.speak({
      actorId: 'actor-1',
      id,
      utteranceId,
      sentenceIndex: 1,
    });
    assert({
      given: "a request for the second sentence's voice",
      should: 'return audio and count its characters',
      actual: {
        bytes: audio.byteLength,
        tts: store.records.get(id)?.ttsCharacters,
      },
      expected: { bytes: 1, tts: 'My first contention is safety.'.length },
    });
    assert({
      given: 'a debate against Wren',
      should:
        "write the speech in Wren's character and voice it in Wren's voice",
      actual: {
        persona: voice.personas[0]?.includes('You are Wren'),
        voiced: voice.calls.includes(
          'speak:bf_emma:My first contention is safety.',
        ),
      },
      expected: { persona: true, voiced: true },
    });
    const replay = await collect(
      operations.speech({ actorId: 'actor-1', id, turnIndex: 0 }),
    );
    assert({
      given: 'a second request for the same speech (a reload)',
      should: 'replay the saved sentences without asking the model again',
      actual: replay.length,
      expected: 4,
    });
  });

  test('refuses the AI speech outside its turn', async () => {
    const { operations, begin } = setup({ personSide: 'affirmative' });
    const id = await begin();
    await assertRejects({
      given: 'the AC belonging to the person',
      should: 'refuse with CONFLICT',
      actual: () =>
        collect(operations.speech({ actorId: 'actor-1', id, turnIndex: 0 })),
      code: 'CONFLICT',
    });
  });
});

describe("the person's speech and cross-examination", () => {
  test("transcribes the person's speech in their turn, with grace after it", async () => {
    const { operations, begin, store, time } = setup({
      personSide: 'affirmative',
    });
    const id = await begin();
    await assertRejects({
      given: 'a chunk during the countdown into the AC',
      should: 'refuse it: the person speaks only once the turn is live',
      actual: () =>
        operations.transcribe({
          actorId: 'actor-1',
          id,
          turnIndex: 0,
          audioBase64: 'AA',
          format: 'webm',
        }),
      code: 'CONFLICT',
    });
    time.advance(311); // one second after the AC ended
    const { text } = await operations.transcribe({
      actorId: 'actor-1',
      id,
      turnIndex: 0,
      audioBase64: 'AA',
      format: 'webm',
    });
    assert({
      given: 'a chunk arriving one second after the AC ended',
      should: 'still transcribe it into the AC',
      actual: { text, line: store.records.get(id)?.utterances[0] },
      expected: {
        text: 'I think the evidence is clear.',
        line: {
          id: 'x-2',
          sequence: 0,
          turnIndex: 0,
          role: 'person',
          text: 'I think the evidence is clear.',
          complete: true,
        },
      },
    });
    time.advance(10);
    await assertRejects({
      given: 'a chunk ten seconds later',
      should: 'refuse it as late',
      actual: () =>
        operations.transcribe({
          actorId: 'actor-1',
          id,
          turnIndex: 0,
          audioBase64: 'AA',
          format: 'webm',
        }),
      code: 'CONFLICT',
    });
  });

  test('the AI opens cross-examination with a question, then answers the next exchange', async () => {
    const { operations, begin, time } = setup({ personSide: 'affirmative' });
    const id = await begin();
    time.advance(310); // the countdown into the first CX: the AI asks
    const opening = await operations.crossExamine({
      actorId: 'actor-1',
      id,
      turnIndex: 1,
    });
    await assertRejects({
      given: "the person's audio before the CX is live",
      should: 'refuse it',
      actual: () =>
        operations.crossExamine({
          actorId: 'actor-1',
          id,
          turnIndex: 1,
          audio: { base64: 'AA', format: 'webm' },
        }),
      code: 'CONFLICT',
    });
    time.advance(10); // the CX is live
    const next = await operations.crossExamine({
      actorId: 'actor-1',
      id,
      turnIndex: 1,
      audio: { base64: 'AA', format: 'webm' },
    });
    assert({
      given: 'the AI asking and nothing said yet, during the countdown',
      should: 'prepare its opening question early',
      actual: opening.reply?.sentences,
      expected: ['Is that your strongest example?'],
    });
    assert({
      given: "the person's answer",
      should: 'transcribe it and reply with the next question',
      actual: { heard: next.heard, reply: next.reply?.sentences },
      expected: {
        heard: 'I think the evidence is clear.',
        reply: ['Is that your strongest example?'],
      },
    });
  });

  test('keeps only the heard part of an interrupted line', async () => {
    const { operations, begin, store, time } = setup({
      personSide: 'affirmative',
      voice: scriptedVoice({
        reply: 'First question here. And a second part.',
      }),
    });
    const id = await begin();
    time.advance(310);
    const opening = await operations.crossExamine({
      actorId: 'actor-1',
      id,
      turnIndex: 1,
    });
    await operations.heard({
      actorId: 'actor-1',
      id,
      utteranceId: opening.reply!.utteranceId,
      sentenceIndex: 1,
      playedMs: 0,
      totalMs: 1000,
    });
    assert({
      given: 'a barge-in at the start of the second sentence',
      should: 'keep only the first sentence',
      actual: store.records.get(id)?.utterances.at(-1)?.text,
      expected: 'First question here.',
    });
  });
});
