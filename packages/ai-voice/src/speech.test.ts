import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createPhraseStream,
  phrasesOf,
  splitSentences,
  wordBudget,
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
});

describe('phrases, ramping up', () => {
  test('the second phrase stays short so the speaker gets going', () => {
    // Each sentence is 39 characters long.
    const sentence = (n: number) =>
      `Sentence number ${n} says one plain thing.`;
    const text = Array.from({ length: 12 }, (_, n) => sentence(n + 1)).join(
      ' ',
    );
    assert({
      given: 'twelve 39-character sentences and the default limits',
      should:
        'voice one sentence, then up to 160 characters, then up to 320, each a whole number of sentences',
      actual: phrasesOf(text).map((phrase) => splitSentences(phrase).length),
      expected: [1, 4, 7],
    });
  });
});

describe('createPhraseStream', () => {
  const text =
    'Thank you, judge. I stand against the resolution! Why? It grew 3.5 percent. ' +
    'She said "no." Then it fell.\n\nMy second point is longer and it carries on for a good while so that phrases close as the limit is reached, again and again. ' +
    'A third. A fourth sentence follows here. And a tail without a stop';
  /** Streams `text` in pieces of `size` and returns the phrases in the order closed. */
  const streamed = (size: number) => {
    const stream = createPhraseStream();
    const phrases: string[] = [];
    for (let at = 0; at < text.length; at += size)
      phrases.push(...stream.push(text.slice(at, at + size)));
    return [...phrases, ...stream.end()];
  };
  test('equals the phrases of the finished text, however it is cut', () => {
    for (const size of [1, 2, 3, 7, 16, 61, 1000])
      assert({
        given: `text arriving ${size} characters at a time`,
        should: 'close exactly the phrases of the finished text',
        actual: streamed(size),
        expected: phrasesOf(text),
      });
  });
  test('gives the opening sentence as soon as it is written', () => {
    const stream = createPhraseStream();
    assert({
      given: 'a first sentence and the start of the next',
      should: 'close the first phrase before the rest exists',
      actual: [stream.push('Thank you, judge.'), stream.push(' I st')],
      expected: [[], ['Thank you, judge.']],
    });
  });
  test('a cut stream never speaks an unfinished sentence', () => {
    const stream = createPhraseStream();
    stream.push('One. Two is whole. Three is unfini');
    assert({
      given: 'text that stopped mid-sentence',
      should: 'give the whole sentences still open and drop the fragment',
      actual: stream.cut(),
      expected: ['Two is whole.'],
    });
  });
});
