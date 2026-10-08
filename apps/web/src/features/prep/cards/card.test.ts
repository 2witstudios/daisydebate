import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  citationCompleteness,
  currentVersion,
  readView,
  readWords,
  type Card,
  type Segment,
} from './card';

setupRitewayBun();

const segments: readonly Segment[] = [
  { kind: 'context', text: 'one two ' },
  { kind: 'read', text: 'three four five ' },
  { kind: 'keep', text: 'six ' },
  { kind: 'context', text: 'seven' },
];

describe('card layers', () => {
  test('words read aloud', () => {
    assert({
      given: 'context, read, keep and context layers',
      should: 'count only the read layer',
      actual: readWords(segments),
      expected: 3,
    });
  });

  test('read view', () => {
    assert({
      given: 'a read passage inside context',
      should: 'show the passage between ellipses and hide the rest',
      actual: readView(segments).map((s) => s.text),
      expected: ['…', 'three four five ', '…'],
    });
  });

  test('read view at the edges', () => {
    assert({
      given: 'a read passage at the very start',
      should: 'leave out the leading ellipsis',
      actual: readView([{ kind: 'read', text: 'a' }]).map((s) => s.text),
      expected: ['a'],
    });
  });
});

describe('citationCompleteness', () => {
  const full = {
    author: 'a',
    qualifications: 'q',
    publication: 'p',
    title: 't',
    published: '2020-01-01',
    url: 'u',
    credibilityNotes: 'c',
  };
  test('complete and two missing', () => {
    assert({
      given: 'a full citation, and one missing a date and a note',
      should: 'count 7 of 7, then 5 of 7 naming what is missing',
      actual: [
        citationCompleteness(full),
        citationCompleteness({ ...full, published: ' ', credibilityNotes: '' }),
      ],
      expected: [
        { filled: 7, total: 7, percent: 100, missing: [] },
        {
          filled: 5,
          total: 7,
          percent: 71,
          missing: ['publication date', 'credibility note'],
        },
      ],
    });
  });
});

describe('currentVersion', () => {
  test('newest first', () => {
    const card = {
      id: 'x',
      versions: [{ version: 3 }, { version: 2 }],
    } as unknown as Card;
    assert({
      given: 'a card with versions newest first',
      should: 'take the first as current',
      actual: currentVersion(card).version,
      expected: 3,
    });
  });
});
