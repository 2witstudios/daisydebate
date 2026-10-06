import { ballotCategories } from '@daisy/protocol';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotDebaters } from '../../mock/judge';
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
  conduct: 'report',
  'low-point': 'confirmed',
};

const render = (
  values: Readonly<Record<string, string>>,
  error: string | undefined = undefined,
) =>
  renderToString(
    h(BallotFields, {
      debaters: sampleBallotDebaters,
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
  test('a refusal keeps everything posted', () => {
    const html = render(refused, 'Write the reason for your decision.');
    assert({
      given: 'the values of a refused ballot and its message',
      should:
        'render the message, the picked winner, every score, the reason, both pieces of feedback, the conduct report and the confirmation as posted',
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
        inputFor(html, 'conduct', 'report').includes('checked'),
        inputFor(html, 'low-point', 'confirmed').includes('checked'),
      ],
      expected: [true, true, false, 10, true, true, true, true],
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
        inputFor(fresh, 'low-point', 'confirmed') !== '' &&
          !inputFor(fresh, 'low-point', 'confirmed').includes('checked'),
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
