import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FormError, FormField } from './form-field';

setupRitewayBun();

describe('FormField', () => {
  test('a labelled control with a helper', () => {
    const html = renderToString(
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
        html.includes('for="speech"'),
        html.includes('Speech length'),
        html.includes('In minutes.'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('FormError', () => {
  test('an error, and none', () => {
    assert({
      given: 'a refusal and no refusal',
      should:
        'announce the first as an alert and render nothing for the second',
      actual: [
        renderToString(h(FormError, { error: 'No.' })).includes('role="alert"'),
        renderToString(h(FormError, { error: undefined })),
      ],
      expected: [true, ''],
    });
  });
});
