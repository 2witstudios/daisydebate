import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  accept,
  field,
  formValues,
  mockFormUnavailable,
  refuse,
  refused,
} from './form';

setupRitewayBun();

const posted = (entries: Record<string, string | Blob>): FormData => {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
};

describe('formValues', () => {
  test('text fields only', () => {
    assert({
      given: 'a form with two text fields and one file',
      should: 'keep the text and skip the file',
      actual: formValues(posted({ a: '1', b: '2', c: new Blob(['x']) })),
      expected: { a: '1', b: '2' },
    });
  });
});

describe('field', () => {
  test('trimmed, empty when absent', () => {
    assert({
      given: 'a padded value and a missing one',
      should: 'trim the first and read the second as empty',
      actual: [
        field(posted({ name: '  Room  ' }), 'name'),
        field(posted({}), 'name'),
      ],
      expected: ['Room', ''],
    });
  });
});

describe('answers', () => {
  test('a refusal keeps what was typed', () => {
    assert({
      given: 'a refused post',
      should: 'answer with the typed values and the error',
      actual: refused(posted({ name: 'x' }), 'Too short.'),
      expected: { values: { name: 'x' }, error: 'Too short.' },
    });
  });

  test('unavailable keeps what was typed too', () => {
    assert({
      given: 'a post the server never answered',
      should: 'keep the values and say to try again',
      actual: mockFormUnavailable(posted({ name: 'x' })),
      expected: {
        values: { name: 'x' },
        error: 'Something went wrong. Try again.',
      },
    });
  });

  test('parsed results', () => {
    assert({
      given: 'accept and refuse',
      should: 'carry a value or an error',
      actual: [accept(3), refuse('No.')],
      expected: [
        { ok: true, value: 3 },
        { ok: false, error: 'No.' },
      ],
    });
  });
});
