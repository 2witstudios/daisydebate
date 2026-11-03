import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ReportForm } from './report-form';

setupRitewayBun();

const render = (targetKind: 'round' | 'ballot_feedback') =>
  renderToStaticMarkup(
    <ReportForm
      targetKind={targetKind}
      targetId="target-id"
      label="Report"
      action={() => {}}
    />,
  );

describe('The report form', () => {
  test('it posts plain fields naming its target', () => {
    const html = render('round');
    assert({
      given: 'a Round',
      should: 'carry the target and offer its reasons',
      actual: [
        html.includes('name="targetKind" value="round"'),
        html.includes('name="targetId" value="target-id"'),
        html.includes('value="result_dispute"'),
      ],
      expected: [true, true, true],
    });
  });

  test('ballot feedback has its one reason', () => {
    const html = render('ballot_feedback');
    assert({
      given: 'ballot feedback',
      should: 'offer abusive feedback and nothing else',
      actual: [
        html.includes('value="abusive_feedback"'),
        html.match(/<option/g)?.length,
      ],
      expected: [true, 1],
    });
  });
});
