import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eventFormAnswer } from './event-form';

setupRitewayBun();

test('tournament age refusals keep the participant’s entry details', () => {
  const form = new FormData();
  form.set('name', 'League entry');
  const ageRefusals = [
    ['over-youth-age', 'This tournament is for debaters under 18.'],
    [
      'under-open-age',
      'You aren’t eligible to debate under this tournament’s age rule.',
    ],
    [
      'age-band',
      'This tournament needs a current age record. Check your account settings.',
    ],
  ];
  assert({
    given: 'a stored entry submission refused by the tournament age rule',
    should: 'show the eligibility reason and retain the submitted fields',
    actual: ageRefusals.map(([refusal]) =>
      eventFormAnswer(form, { kind: 'refused', refusal }),
    ),
    expected: ageRefusals.map(([, error]) => ({
      kind: 'refused',
      values: { name: 'League entry' },
      error,
    })),
  });
});
