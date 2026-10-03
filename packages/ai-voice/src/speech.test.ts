import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createSentenceBuffer,
  heardText,
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
