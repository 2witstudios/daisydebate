import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { FormError, FormField } from './form-field';

setupRitewayBun();

describe('FormField', () => {
  test('a labelled control with a helper', () => {
    const view = renderAccessible(
      h(FormField, {
        id: 'speech',
        label: 'Speech length',
        helper: 'In minutes.',
        children: h('input', { id: 'speech' }),
      }),
    );
    assert({
      given: 'a field with a label and helper',
      should: 'tie the label to the control and show the helper',
      actual: [
        view.has('textbox', 'Speech length'),
        view.textContent().includes('In minutes.'),
      ],
      expected: [true, true],
    });
  });
});

describe('FormError', () => {
  test('an error, and none', () => {
    const refusal = renderAccessible(h(FormError, { error: 'No.' })).text(
      'alert',
    );
    const none = renderAccessible(h(FormError, { error: undefined }));
    assert({
      given: 'a refusal and no refusal',
      should:
        'announce the first as an alert and render nothing for the second',
      actual: [refusal, [none.count('alert'), none.textContent()]],
      expected: ['No.', [0, '']],
    });
  });
});
