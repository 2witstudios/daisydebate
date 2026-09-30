import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { submitOnChange, type ChangedControl } from './submit-on-change';

setupRitewayBun();

const submitted = (tagName: string, type?: string): number => {
  let submits = 0;
  const control: ChangedControl = {
    tagName,
    ...(type === undefined ? {} : { type }),
    form: {
      requestSubmit: () => {
        submits += 1;
      },
    },
  };
  submitOnChange(control);
  return submits;
};

describe('submitOnChange', () => {
  test('which controls apply on change', () => {
    assert({
      given: 'a select, a radio, a search field and a checkbox changing',
      should: 'submit for the select and the radio only',
      actual: [
        submitted('SELECT'),
        submitted('INPUT', 'radio'),
        submitted('INPUT', 'search'),
        submitted('INPUT', 'checkbox'),
      ],
      expected: [1, 1, 0, 0],
    });
  });

  test('a control outside a form', () => {
    assert({
      given: 'a select with no form',
      should: 'do nothing and not throw',
      actual: (() => {
        submitOnChange({ tagName: 'SELECT', form: null });
        return true;
      })(),
      expected: true,
    });
  });
});
