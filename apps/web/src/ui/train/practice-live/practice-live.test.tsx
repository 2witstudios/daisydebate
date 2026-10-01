import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveView, type SpeechView } from '../../../features/train/live';
import { liveLinks, type LiveQuery } from '../../../features/train/live-links';
import {
  defaultConfig,
  type PracticeConfig,
} from '../../../features/train/practice';
import { defaultHubQuery } from '../../../features/train/query';
import { mockOpponent } from '../../mock/train-practice';
import { PracticeLive } from './practice-live';

setupRitewayBun();

const render = (
  seq: number,
  query: Partial<LiveQuery> = {},
  config: PracticeConfig = defaultConfig,
) => {
  const view = liveView(config, 'aff', seq, mockOpponent) as SpeechView;
  const full = { seq, hint: false, confirmEnd: false, ...query };
  return renderToString(
    h(PracticeLive, {
      view,
      links: liveLinks(config, defaultHubQuery, view, full),
      query: full,
    }),
  );
};

describe('PracticeLive', () => {
  test('your turn', () => {
    const html = render(1);
    assert({
      given: 'your first turn',
      should: 'show the heading, the timer, coach prompts and the turns',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Turn 1: Aff speech'),
        html.includes('Turn 1 of 5'),
        html.includes('role="timer"'),
        html.includes('5:00'),
        html.includes('You are speaking'),
        html.includes('Listening to you'),
        html.includes('Coach prompts'),
        html.includes('State your claim in one sentence'),
        html.includes('Prep time left'),
        html.includes('You are Aff'),
        html.includes('Practice · Unrated'),
      ],
      expected: [
        1,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
      ],
    });
  });

  test("the opponent's turn has a notes box and no dialog", () => {
    const html = render(2);
    assert({
      given: "the AI debater's turn",
      should: 'show its sample output and a notes field',
      actual: [
        html.includes('The AI debater is speaking'),
        html.includes('Sample output'),
        html.includes('id="notes"'),
        html.includes('role="dialog"'),
        html.includes('Report a problem with the opponent'),
        html.includes('href="/train/practice/unavailable?turn=2"'),
      ],
      expected: [true, true, true, false, true, true],
    });
  });

  test('your own turn has no problem report', () => {
    assert({
      given: 'your own turn',
      should: 'not offer to report the opponent',
      actual: render(1).includes('Report a problem'),
      expected: false,
    });
  });

  test('the hint toggles by link', () => {
    const closed = render(1);
    const open = render(1, { hint: true });
    assert({
      given: 'the hint closed, then open',
      should: 'offer Hint, then show the hint text and Hide hint',
      actual: [
        closed.includes('>Hint<'),
        closed.includes('Start with the claim in one sentence'),
        open.includes('Hide hint'),
        open.includes('Start with the claim in one sentence'),
      ],
      expected: [true, false, true, true],
    });
  });

  test('coaching off leaves no prompts and no hint link', () => {
    const html = render(
      1,
      {},
      { ...defaultConfig, coach: false, hints: false },
    );
    assert({
      given: 'coach prompts and hints off',
      should: 'show neither',
      actual: [html.includes('Coach prompts'), html.includes('>Hint<')],
      expected: [false, false],
    });
  });

  test('End debate asks first, with a way to keep going', () => {
    const html = render(3, { confirmEnd: true });
    assert({
      given: 'the end confirmation open on turn 3',
      should: 'show the dialog with both links',
      actual: [
        html.includes('aria-label="End this debate"'),
        html.includes('href="/train/practice/debrief?upto=3"'),
        html.includes('Keep going'),
      ],
      expected: [true, true, true],
    });
  });

  test('the last turn finishes into the debrief', () => {
    const html = render(5);
    assert({
      given: 'the last turn',
      should: 'offer Finish and see debrief and no End speech',
      actual: [
        html.includes('Finish and see debrief'),
        html.includes('End speech'),
      ],
      expected: [true, false],
    });
  });
});
