import type { RoomView } from '@daisy/protocol/room-contract';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { AiJudgeNotice, aiJudgeSeatable } from './ai-judge-notice';

setupRitewayBun();

const render = (
  aiJudgeSeating: RoomView['aiJudgeSeating'],
  judge = 1,
  competitionType: 'ranked' | 'casual' = 'ranked',
) =>
  renderAccessible(
    <AiJudgeNotice
      view={
        {
          aiJudgeSeating,
          competitionType,
          definition: { seats: { judges: judge } },
        } as never
      }
    />,
  );
const text = (
  aiJudgeSeating: RoomView['aiJudgeSeating'],
  judge?: number,
  competitionType?: 'ranked' | 'casual',
) => render(aiJudgeSeating, judge, competitionType).textContent();

test('a free host past their AI-judged Round sees the upgrade panel in place', () => {
  const view = render('premium', 1, 'casual');
  const html = view.text('status');
  assert({
    given: 'a casual host whose free AI-judged Round is used',
    should:
      'show the Premium panel with Get Premium and Invite a judge, and no count',
    actual: [
      html.includes('AI judging on casual Rounds is Premium'),
      html.includes('You’ve used your free AI-judged Round.'),
      html.includes('Ranked Rounds include an AI judge free.'),
      view.attribute('link', 'Get Premium', 'href'),
      view.has('button', 'Invite a judge'),
      /\d+ of \d+|remaining/.test(view.textContent()),
    ],
    expected: [true, true, true, '/premium', true, false],
  });
});

test('a free host whose AI judge comes with the bot Round is told so', () => {
  const html = render('with-bot', 1, 'casual').text('status');
  assert({
    given: 'a casual host who has not used the free bot Round',
    should: 'say the free AI-judged Round comes with it, not that it is used',
    actual: [
      html.includes('comes with your free bot Round'),
      html.includes('You’ve used'),
    ],
    expected: [true, false],
  });
});

test('a host refused for another reason gets the panel without a false "used" claim', () => {
  const view = render('not-included', 1, 'casual');
  const html = view.text('status');
  assert({
    given: 'a casual host whose account holds no AI judging (a lapsed grant)',
    should: 'show the Premium panel and never say a free Round was used',
    actual: [
      html.includes('AI judging on casual Rounds is Premium'),
      view.attribute('link', 'Get Premium', 'href'),
      html.includes('You’ve used'),
      html.includes('comes with your free bot Round'),
    ],
    expected: [true, '/premium', false, false],
  });
});

test('the host is told plainly what judging is available', () => {
  assert({
    given: 'a ranked host, a free casual bot bundle and a host at the ceiling',
    should:
      'say the AI judge is free, describe the lifetime judge, and name fair use without a number',
    actual: [
      render('free').text('status').includes('free on ranked rounds'),
      render('free', 1, 'casual').text('status'),
      render('fair-use', 1, 'casual')
        .text('status')
        .includes('fair-use ceiling'),
      /\d/.test(text('fair-use', 1, 'casual')),
    ],
    expected: [
      true,
      'Your one free bot debate includes an optional AI judge.',
      true,
      false,
    ],
  });
  assert({
    given: 'an entitled casual host, a non-host, and a Room with no judge seat',
    should: 'say nothing',
    actual: [text('included'), text(null), text('premium', 0)],
    expected: ['', '', ''],
  });
});

test('only free and included seating offers the AI judge', () => {
  assert({
    given: 'each seating',
    should: 'offer the AI judge only when free or included',
    actual: (
      [
        'free',
        'included',
        'premium',
        'with-bot',
        'not-included',
        'fair-use',
        null,
      ] as const
    ).map(aiJudgeSeatable),
    expected: [true, true, false, false, false, false, false],
  });
});
