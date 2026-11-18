import { renderToString } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AiJudgeNotice, aiJudgeSeatable } from './ai-judge-notice';

setupRitewayBun();

const render = (
  aiJudgeSeating: RoomView['aiJudgeSeating'],
  judge = 1,
  competitionType: 'ranked' | 'casual' = 'ranked',
) =>
  renderToString(
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
const text = (html: string) => html.replaceAll('&#x27;', "'");
const words = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&#?\w+;/g, ' ');

test('a free host past their AI-judged Round sees the upgrade panel in place', () => {
  const html = text(render('premium', 1, 'casual'));
  assert({
    given: 'a casual host whose free AI-judged Round is used',
    should:
      'show the Premium panel with Get Premium and Invite a judge, and no count',
    actual: [
      html.includes('AI judging on casual Rounds is Premium'),
      html.includes('You’ve used your free AI-judged Round.'),
      html.includes('Ranked Rounds include an AI judge free.'),
      html.includes('href="/premium"'),
      html.includes('Invite a judge'),
      /\d+ of \d+|remaining/.test(words(html)),
    ],
    expected: [true, true, true, true, true, false],
  });
});

test('a free host whose AI judge comes with the bot Round is told so', () => {
  const html = text(render('with-bot', 1, 'casual'));
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
  const html = text(render('not-included', 1, 'casual'));
  assert({
    given: 'a casual host whose account holds no AI judging (a lapsed grant)',
    should: 'show the Premium panel and never say a free Round was used',
    actual: [
      html.includes('AI judging on casual Rounds is Premium'),
      html.includes('href="/premium"'),
      html.includes('You’ve used'),
      html.includes('comes with your free bot Round'),
    ],
    expected: [true, true, false, false],
  });
});

test('the host is told plainly what judging is available', () => {
  assert({
    given: 'a ranked host, a free casual bot bundle and a host at the ceiling',
    should:
      'say the AI judge is free, describe the lifetime judge, and name fair use without a number',
    actual: [
      render('free').includes('free on ranked rounds'),
      render('free', 1, 'casual').includes(
        'Your one free bot debate includes an optional AI judge.',
      ),
      text(render('fair-use', 1, 'casual')).includes('fair-use ceiling'),
      /\d/.test(words(render('fair-use', 1, 'casual'))),
    ],
    expected: [true, true, true, false],
  });
  assert({
    given: 'an entitled casual host, a non-host, and a Room with no judge seat',
    should: 'say nothing',
    actual: [render('included'), render(null), render('premium', 0)],
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
