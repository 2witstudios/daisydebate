import { ballotPlanFor } from '../../../features/judge/ballot-plan';
import { sampleBallotRound } from '../../../features/judge/ballot-plan.test-support';
import { ballotCategories } from '@daisy/protocol';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
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
  renderToString(
    h(BallotFields, {
      plan: sampleBallotPlan,
      values,
      error,
      pending: false,
    }),
  );

const inputFor = (html: string, name: string, value: string) =>
  html.match(
    new RegExp(
      `<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>|<input[^>]*value="${value}"[^>]*name="${name}"[^>]*>`,
    ),
  )?.[0] ?? '';

describe('BallotFields', () => {
  test('a missing written part is refused by the server, not the browser', () => {
    const html = render({});
    const textareas = html.match(/<textarea[^>]*>/g) ?? [];
    assert({
      given: 'an empty ballot whose reason the definition requires',
      should:
        'render the reason and feedback boxes without a required attribute, so the post reaches the server, which refuses it and keeps everything (ISSUE-348)',
      actual: {
        boxes: textareas.length > 0,
        required: textareas.filter((tag) => /\srequired(=|\s|>)/.test(tag))
          .length,
      },
      expected: { boxes: true, required: 0 },
    });
  });

  test('a refusal keeps everything posted', () => {
    const html = render(refused, 'Write the reason for your decision.');
    assert({
      given: 'the values of a refused ballot and its message',
      should:
        'render the message, the picked winner, every score, the reason, both pieces of feedback and the confirmation as posted, without an unavailable reporting control',
      actual: [
        html.includes('Write the reason for your decision.'),
        inputFor(html, 'winner', 'negative').includes('checked'),
        inputFor(html, 'winner', 'affirmative').includes('checked'),
        (
          html.match(
            /type="range"[^>]*value="4"|value="4"[^>]*type="range"/g,
          ) ?? []
        ).length,
        html.includes('Daniel answered every argument.'),
        html.includes('Slow down in the rebuttal.') &&
          html.includes('Weigh the impacts.'),
        html.includes('name="conduct"'),
        inputFor(html, 'low-point', 'negative:40:30').includes('checked'),
      ],
      expected: [true, true, false, 10, true, true, false, true],
    });
  });

  test('the low-point confirmation', () => {
    const level = render({ ...refused, ...scoresAt('affirmative', '3') });
    const fresh = render({ ...refused, 'low-point': '' });
    assert({
      given: 'a win on fewer points, unconfirmed, and a win on level points',
      should:
        'ask for a confirmation naming the winner and both totals, and ask nothing on level points',
      actual: [
        fresh.includes('Daniel Kim wins with fewer points: 30 to 40'),
        inputFor(fresh, 'low-point', 'negative:40:30') !== '' &&
          !inputFor(fresh, 'low-point', 'negative:40:30').includes('checked'),
        level.includes('name="low-point"'),
      ],
      expected: [true, true, false],
    });
  });

  test('a fresh ballot', () => {
    const html = render({});
    assert({
      given: 'no values yet',
      should:
        'pick no winner, start every score at 3, show no message and no read-outs before script runs',
      actual: [
        html.includes('checked=""'),
        (
          html.match(
            /type="range"[^>]*value="3"|value="3"[^>]*type="range"/g,
          ) ?? []
        ).length,
        html.includes('role="alert"'),
        html.includes('No winner picked'),
      ],
      expected: [false, 20, false, false],
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
  const html = renderToString(
    h(BallotFields, { plan, values: {}, error: undefined, pending: false }),
  );
  assert({
    given:
      'the actual canonical custom definition and two real sample competitors',
    should:
      'render both speaker places, offset scale and explicit default, without forbidden written or private-note controls',
    actual: [
      html.includes('name="speaker-place-1"'),
      html.includes('name="speaker-place-2"'),
      html.includes('min="0.25"'),
      html.includes('max="0.56"'),
      html.includes('step="0.1"'),
      html.includes('value="0.35"'),
      html.includes('name="reason"'),
      html.includes('name="feedback-'),
      html.includes('name="privateNote"'),
    ],
    expected: [true, true, true, true, true, true, false, false, false],
  });
});
