import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { ReportForm } from './report-form';

setupRitewayBun();

const render = (targetKind: 'round' | 'ballot_feedback') =>
  renderAccessible(
    <ReportForm
      targetKind={targetKind}
      targetId="target-id"
      label="Report"
      action={() => {}}
    />,
  );

/**
 * A field the form posts, by name; the target travels in hidden inputs,
 * which have no role. The form sits under a closed details element, so its
 * controls are queried with `hidden: true`: rendered, not yet shown.
 */
const posted = (view: ReturnType<typeof render>, name: string) =>
  view
    .get('button', 'Send report', { hidden: true })
    .closest('form')
    ?.querySelector(`input[name="${name}"]`)
    ?.getAttribute('value');

const reasons = (view: ReturnType<typeof render>) =>
  view
    .within('combobox', 'Reason', { hidden: true })
    .all('option', undefined, { hidden: true })
    .map((option) => option.getAttribute('value'));

describe('The report form', () => {
  test('it posts plain fields naming its target', () => {
    const view = render('round');
    assert({
      given: 'a Round',
      should: 'carry the target and offer its reasons',
      actual: [
        posted(view, 'targetKind') === 'round',
        posted(view, 'targetId') === 'target-id',
        reasons(view).includes('result_dispute'),
      ],
      expected: [true, true, true],
    });
  });

  test('ballot feedback has its one reason', () => {
    const view = render('ballot_feedback');
    assert({
      given: 'ballot feedback',
      should: 'offer abusive feedback and nothing else',
      actual: reasons(view),
      expected: ['abusive_feedback'],
    });
  });
});
