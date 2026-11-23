import { ballotPlanFor } from '../../../features/judge/ballot-plan';
import { sampleBallotRound } from '../../../features/judge/ballot-plan.test-support';
import { ballotCategories } from '@daisy/protocol/ballot';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { BallotFields } from './ballot-form';

setupRitewayBun();

const scoresAt = (side: string, score: string) =>
  Object.fromEntries(ballotCategories.map((c) => [`${side}-${c}`, score]));

/** A refused low-point win: Daniel Kim picked on 30 against 40. */
const refused = {
  winner: 'negative',
  ...scoresAt('affirmative', '4'),
  ...scoresAt('negative', '3'),
  reason: 'Daniel answered every argument.',
  'feedback-affirmative': 'Slow down in the rebuttal.',
  'feedback-negative': 'Weigh the impacts.',
  'low-point': 'negative:40:30',
};

const render = (
  values: Readonly<Record<string, string>>,
  error: string | undefined = undefined,
) =>
  renderAccessible(
    h(BallotFields, {
      plan: sampleBallotPlan,
      values,
      error,
      pending: false,
    }),
  );

/** Every control the ballot posts, by the field name it posts under. */
const fieldNames = (view: AccessibleView) =>
  (['textbox', 'radio', 'checkbox', 'slider', 'combobox'] as const).flatMap(
    (role) => view.all(role).map((control) => control.getAttribute('name')),
  );

/** The posted values of the checked controls with that field name. */
const checked = (view: AccessibleView, name: string) =>
  (['radio', 'checkbox'] as const).flatMap((role) =>
    view
      .all(role, undefined, { checked: true })
      .filter((control) => control.getAttribute('name') === name)
      .map((control) => control.getAttribute('value')),
  );

const slidersAt = (view: AccessibleView, value: string) =>
  view.all('slider').filter((slider) => slider.getAttribute('value') === value)
    .length;

describe('BallotFields', () => {
  test('a missing written part is refused by the server, not the browser', () => {
    const textareas = render({})
      .all('textbox')
      .filter((box) => box.tagName === 'TEXTAREA');
    assert({
      given: 'an empty ballot whose reason the definition requires',
      should:
        'render the reason and feedback boxes without a required attribute, so the post reaches the server, which refuses it and keeps everything (ISSUE-348), while assistive tech still hears that the reason is required',
      actual: {
        boxes: textareas.length > 0,
        required: textareas.filter((box) => box.hasAttribute('required'))
          .length,
        announced: textareas.some(
          (box) => box.getAttribute('aria-required') === 'true',
        ),
      },
      expected: { boxes: true, required: 0, announced: true },
    });
  });

  test('a refusal keeps everything posted', () => {
    const view = render(refused, 'Write the reason for your decision.');
    const value = (name: string) =>
      (view.get('textbox', name) as HTMLTextAreaElement).value;
    assert({
      given: 'the values of a refused ballot and its message',
      should:
        'render the message, the picked winner, every score, the reason, both pieces of feedback and the confirmation as posted, without an unavailable reporting control',
      actual: [
        view.textContent().includes('Write the reason for your decision.'),
        checked(view, 'winner'),
        slidersAt(view, '4'),
        value('Reason for decision'),
        [value('Feedback for Maya'), value('Feedback for Daniel')],
        fieldNames(view).includes('conduct'),
        checked(view, 'low-point'),
      ],
      expected: [
        true,
        ['negative'],
        10,
        'Daniel answered every argument.',
        ['Slow down in the rebuttal.', 'Weigh the impacts.'],
        false,
        ['negative:40:30'],
      ],
    });
  });

  test('the low-point confirmation', () => {
    const level = fieldNames(
      render({ ...refused, ...scoresAt('affirmative', '3') }),
    ).includes('low-point');
    const fresh = render({ ...refused, 'low-point': '' });
    assert({
      given: 'a win on fewer points, unconfirmed, and a win on level points',
      should:
        'ask for a confirmation naming the winner and both totals, and ask nothing on level points',
      actual: [
        fresh
          .textContent()
          .includes('Daniel Kim wins with fewer points: 30 to 40'),
        fresh.attribute('checkbox', 'Confirm the decision', 'value', {
          checked: false,
        }),
        level,
      ],
      expected: [true, 'negative:40:30', false],
    });
  });

  test('a fresh ballot', () => {
    const view = render({});
    assert({
      given: 'no values yet',
      should:
        'pick no winner, start every score at 3, show no message and no read-outs before script runs',
      actual: [
        view.count('radio', undefined, { checked: true }) +
          view.count('checkbox', undefined, { checked: true }),
        slidersAt(view, '3'),
        view.count('alert'),
        view.textContent().includes('No winner picked'),
      ],
      expected: [0, 20, 0, false],
    });
  });
});

test('a custom ballot renders its actual speaker ranks, canonical scale and off collection policy', () => {
  const definition = {
    ...sampleBallotPlan.definition,
    key: 'custom-render',
    revision: 1,
    points: {
      ...sampleBallotPlan.definition.points!,
      criteria: { kind: 'holistic' as const },
      scale: { min: 0.25, max: 0.56, step: 0.1 },
      default: 0.35,
    },
    speakerRanks: true,
    written: { reason: null, feedback: null },
  };
  const plan = ballotPlanFor(sampleBallotRound, definition);
  const view = renderAccessible(
    h(BallotFields, { plan, values: {}, error: undefined, pending: false }),
  );
  const names = fieldNames(view);
  const slider = view.all('slider')[0];
  assert({
    given:
      'the actual canonical custom definition and two real sample competitors',
    should:
      'render both speaker places, offset scale and explicit default, without forbidden written or private-note controls',
    actual: [
      names.includes('speaker-place-1'),
      names.includes('speaker-place-2'),
      slider?.getAttribute('min'),
      slider?.getAttribute('max'),
      slider?.getAttribute('step'),
      slider?.getAttribute('value'),
      names.includes('reason'),
      names.some((name) => name?.startsWith('feedback-')),
      names.includes('privateNote'),
    ],
    expected: [true, true, '0.25', '0.56', '0.1', '0.35', false, false, false],
  });
});
