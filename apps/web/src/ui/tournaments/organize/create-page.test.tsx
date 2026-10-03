import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getDraft } from '../../../features/tournaments/get-draft';
import {
  wizardSteps,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { CreatePage } from './create-page';

setupRitewayBun();

const base: WizardQuery = {
  step: 'basics',
  structure: 'single-elimination',
  places: 16,
};
const render = (query: Partial<WizardQuery> = {}) =>
  renderToString(
    h(CreatePage, { query: { ...base, ...query }, draft: getDraft() }),
  );

describe('CreatePage', () => {
  test('every step renders one h1 and the step list with its own step current', () => {
    assert({
      given: 'each of the five steps',
      should: 'keep one h1 and mark that step current',
      actual: wizardSteps.map((step) => {
        const html = render({ step });
        return [
          html.match(/<h1 /g)?.length,
          html.includes('aria-label="Steps"'),
          html.match(/aria-current="step"/g)?.length,
        ];
      }),
      expected: wizardSteps.map(() => [1, true, 1]),
    });
  });

  test('the draft is editable and says what stays in the address', () => {
    const html = render();
    assert({
      given: 'the basics step',
      should: 'name the draft and leave every field editable',
      actual: [
        html.includes('stay in the address'),
        /<input id="t-name"/.test(html) &&
          !/<input id="t-name"[^>]*disabled=""/.test(html),
        html.includes('Winter Open'),
        html.includes('Listed on Tournaments'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('size: structure and places are links, and the choice explains itself', () => {
    const html = render({ step: 'size', places: 32 });
    assert({
      given: 'the size step with 32 places',
      should:
        'link both structures and every size, mark the chosen ones and show rounds',
      actual: [
        /href="\/tournaments\/organize\/new\?step=size&amp;structure=round-robin"[^>]*>Round robin</.test(
          html,
        ),
        /href="\/tournaments\/organize\/new\?step=size&amp;places=64"[^>]*>64</.test(
          html,
        ),
        (html.match(/aria-current="true"/g) ?? []).length,
        html.includes(
          '32 places: 5 rounds. If fewer enter, the top seeds get byes.',
        ),
      ],
      expected: [true, true, 2, true],
    });
  });

  test('round robin offers its own sizes and rounds', () => {
    const html = render({ step: 'size', structure: 'round-robin', places: 6 });
    assert({
      given: 'a round robin of 6',
      should: 'offer 4 to 12 and explain five rounds',
      actual: [
        html.includes('>12<'),
        html.includes('>64<'),
        html.includes('6 entrants: each meets every other once, 5 rounds.'),
      ],
      expected: [true, false, true],
    });
  });

  test('schedule lists the round times for the chosen size', () => {
    const html = render({ step: 'schedule', places: 8 });
    assert({
      given: 'eight places',
      should: 'list quarterfinals, semifinals and the final with time fields',
      actual: [
        html.includes('Quarterfinals'),
        html.includes('Semifinals'),
        html.includes('aria-label="Final date"'),
        html.includes('type="datetime-local"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('rules and judging: unrated, assigned by Daisy, never picked', () => {
    const html = render({ step: 'rules' });
    assert({
      given: 'the rules step',
      should:
        'say unrated and judges assigned by Daisy, with the judges needed',
      actual: [
        html.includes('Unrated'),
        html.includes('You cannot choose judges or rounds.'),
        html.includes('up to 8 judges'),
        html.includes('href="?did=Invite"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('review: facts and two sample actions', () => {
    const html = render({ step: 'review' });
    assert({
      given: 'the review step',
      should:
        'list the draft, answer Save draft and Publish as sample actions, and link Back',
      actual: [
        html.includes('Opens 12 Oct, closes 5 Nov, 18:00 UTC'),
        html.includes('href="?did=Save+draft"'),
        html.includes('href="?did=Publish+tournament"'),
        html.includes('href="/tournaments/organize/new?step=rules"'),
        html.includes('>Continue<'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('first step cancels to Organize; middle steps go back and on', () => {
    const first = render();
    const middle = render({ step: 'schedule' });
    assert({
      given: 'the first and a middle step',
      should: 'offer Cancel on the first, Back and Continue in the middle',
      actual: [
        /href="\/tournaments\/organize"[^>]*>Cancel</.test(first),
        /href="\/tournaments\/organize\/new\?step=size"[^>]*>Back</.test(
          middle,
        ),
        /href="\/tournaments\/organize\/new\?step=rules"[^>]*>Continue</.test(
          middle,
        ),
      ],
      expected: [true, true, true],
    });
  });
});
