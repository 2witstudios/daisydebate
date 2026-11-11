import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  accept,
  destinationOf,
  done,
  field,
  formFields,
  formValues,
  formUnavailable,
  idle,
  moved,
  refuse,
  refused,
  unacknowledged,
  type FormState,
  type Unacknowledged,
} from './form-state';

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

describe('an answer is one kind', () => {
  const answers: Record<
    (FormState | Unacknowledged)['kind'],
    FormState | Unacknowledged
  > = {
    idle: idle({ name: 'seed' }),
    refused: refused(posted({ name: 'x' }), 'Too short.'),
    done: done(),
    moved: moved('/lobby'),
    unacknowledged: unacknowledged(posted({ name: 'x' })),
  };
  const each = <T>(read: (answer: FormState | Unacknowledged) => T) =>
    Object.fromEntries(
      Object.entries(answers).map(([kind, answer]) => [kind, read(answer)]),
    );

  test('what each kind leaves the fields to render', () => {
    assert({
      given: 'every shared kind of answer',
      should:
        'render values again only where they were kept, and an error only for a refusal',
      actual: each(formFields),
      expected: {
        idle: { values: { name: 'seed' }, error: undefined },
        refused: { values: { name: 'x' }, error: 'Too short.' },
        done: { values: {}, error: undefined },
        moved: { values: {}, error: undefined },
        unacknowledged: { values: { name: 'x' }, error: undefined },
      },
    });
  });

  test('only a moved answer has a destination', () => {
    assert({
      given: 'every shared kind of answer',
      should: 'send the page somewhere only when it moved',
      actual: each(destinationOf),
      expected: {
        idle: undefined,
        refused: undefined,
        done: undefined,
        moved: '/lobby',
        unacknowledged: undefined,
      },
    });
  });

  test('a contradictory answer does not compile', () => {
    const contradictory: FormState = {
      kind: 'moved',
      next: '/lobby',
      // @ts-expect-error an error exists only on a refusal
      error: 'Too short.',
    };
    assert({
      given: 'a moved answer forced to carry an error past the compiler',
      should: 'still be read by its kind alone',
      actual: [formFields(contradictory).error, destinationOf(contradictory)],
      expected: [undefined, '/lobby'],
    });
  });
});

describe('answers', () => {
  test('a refusal keeps what was typed', () => {
    assert({
      given: 'a refused post',
      should: 'answer with the typed values and the error',
      actual: refused(posted({ name: 'x' }), 'Too short.'),
      expected: { kind: 'refused', values: { name: 'x' }, error: 'Too short.' },
    });
  });

  test('unavailable keeps what was typed too', () => {
    assert({
      given: 'a post the server never answered',
      should: 'keep the values and say to try again',
      actual: formUnavailable(posted({ name: 'x' })),
      expected: {
        kind: 'refused',
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
