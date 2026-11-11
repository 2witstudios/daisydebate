import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialReportForm,
  reported,
  reportFields,
  reportFormUnavailable,
} from './form';

setupRitewayBun();

test('a report answer is one kind: filed, or refused with its notice, never both', () => {
  const answers = [initialReportForm, reported, reportFormUnavailable()];
  assert({
    given: 'nothing posted, a filed report, and one that was not sent',
    should:
      'say nothing, confirm the report with no refusal, and refuse with the try-again notice',
    actual: answers.map((answer) => [answer.kind, reportFields(answer)]),
    expected: [
      ['idle', { filed: false, notice: undefined, refusal: undefined }],
      ['reported', { filed: true, notice: 'Reported.', refusal: undefined }],
      [
        'refused',
        {
          filed: false,
          notice: 'Could not send that report. Try again.',
          refusal: 'Could not send that report. Try again.',
        },
      ],
    ],
  });
});
