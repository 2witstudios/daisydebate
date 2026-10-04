import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createPhraseBuffer,
  createSentenceBuffer,
  heardText,
  phrasesOf,
  splitSentences,
  wordBudget,
  worthTranscribing,
} from './speech';

setupRitewayBun();

describe('splitSentences', () => {
  test('splits prose into sentences', () => {
    assert({
      given: 'three sentences with mixed endings',
      should: 'return each sentence trimmed',
      actual: splitSentences('First point. Second point? Third!  '),
      expected: ['First point.', 'Second point?', 'Third!'],
    });
    assert({
      given: 'an abbreviation-like decimal and trailing text without a stop',
      should: 'keep the decimal and keep the tail as a sentence',
      actual: splitSentences('It grew 3.5 percent. And then'),
      expected: ['It grew 3.5 percent.', 'And then'],
    });
    assert({
      given: 'blank input',
      should: 'return no sentences',
      actual: splitSentences('   '),
      expected: [],
    });
  });
});

describe('wordBudget', () => {
  test('fits a slot at a speaking rate', () => {
    assert({
      given: 'a five minute slot at the default 150 words a minute',
      should: 'aim a little under the slot (90 percent)',
      actual: wordBudget(300_000),
      expected: 675,
    });
  });
});

describe('createSentenceBuffer', () => {
  test('emits sentences as streamed text completes them', () => {
    const buffer = createSentenceBuffer();
    const first = buffer.push('Thank you, judge. My first');
    const second = buffer.push(' contention is safety. Second');
    const rest = buffer.flush();
    assert({
      given: 'a delta that completes one sentence',
      should: 'emit only the completed sentence',
      actual: first,
      expected: ['Thank you, judge.'],
    });
    assert({
      given: 'a delta that completes the next sentence',
      should: 'emit it and hold the unfinished tail',
      actual: second,
      expected: ['My first contention is safety.'],
    });
    assert({
      given: 'the end of the stream',
      should: 'flush the unfinished tail as a sentence',
      actual: rest,
      expected: ['Second'],
    });
  });
});

describe('heardText', () => {
  test('keeps the words played before an interruption', () => {
    assert({
      given: 'half of a reply played',
      should: 'keep the first half, cut at a word boundary',
      actual: heardText('One two three four five six', 500, 1000),
      expected: 'One two three',
    });
    assert({
      given: 'the whole reply played',
      should: 'keep all of it',
      actual: heardText('One two.', 1000, 1000),
      expected: 'One two.',
    });
    assert({
      given: 'nothing played',
      should: 'keep nothing',
      actual: heardText('One two.', 0, 1000),
      expected: '',
    });
  });
});

describe('worthTranscribing', () => {
  test('sends a clip only when someone was speaking in it', () => {
    assert({
      given: 'a clip with two seconds of voice',
      should: 'be sent for transcription',
      actual: worthTranscribing({ voicedMs: 2_000 }),
      expected: true,
    });
    assert({
      given: 'a clip of silence or a cough (under half a second of voice)',
      should: 'not be sent, so the transcriber cannot invent words',
      actual: worthTranscribing({ voicedMs: 300 }),
      expected: false,
    });
  });
});

describe('phrases', () => {
  const text =
    'Thank you, judge. My opponent never showed you where the money comes from. Let me give you a quick roadmap. First, the negative case. Then the affirmative, point by point. My first contention is about service, and it matters more than anything else said today.';

  test('groups whole sentences, opening with one sentence alone', () => {
    const phrases = phrasesOf(text, 80);
    assert({
      given: 'six sentences and an 80-character group limit',
      should:
        'open with the first sentence alone, then group whole sentences up to the limit',
      actual: phrases,
      expected: [
        'Thank you, judge.',
        'My opponent never showed you where the money comes from.',
        'Let me give you a quick roadmap. First, the negative case.',
        'Then the affirmative, point by point.',
        'My first contention is about service, and it matters more than anything else said today.',
      ],
    });
    assert({
      given: 'those phrases joined back into the saved speech',
      should: 'give the same phrases again',
      actual: phrasesOf(phrases.join(' '), 80),
      expected: phrases,
    });
  });

  test('streamed sentences group exactly as the saved speech does', () => {
    const buffer = createPhraseBuffer(80);
    const streamed = [
      ...splitSentences(text).flatMap((sentence) => buffer.push(sentence)),
      ...buffer.flush(),
    ];
    assert({
      given: 'the same sentences arriving one by one',
      should: 'emit the same phrases as grouping the finished text',
      actual: streamed,
      expected: phrasesOf(text, 80),
    });
  });
});
