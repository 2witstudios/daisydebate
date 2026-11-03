import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AiJudgeNotice, aiJudgeSeatable } from './ai-judge-notice';

setupRitewayBun();

const render = (
  aiJudgeSeating: 'free' | 'included' | 'premium' | null,
  judge = 1,
) =>
  renderToString(
    <AiJudgeNotice
      view={
        {
          aiJudgeSeating,
          definition: { seats: { affirmative: 1, negative: 1, judge } },
        } as never
      }
    />,
  );

test('the host is told plainly what judging is available', () => {
  assert({
    given: 'a casual host without the entitlement',
    should: 'say AI judging is premium and offer a person',
    actual: [
      render('premium').includes('AI judging on casual rounds is premium'),
      render('premium').includes('Invite a person to judge'),
    ],
    expected: [true, true],
  });
  assert({
    given: 'a ranked host',
    should: 'say the AI judge is free',
    actual: render('free').includes('free on ranked rounds'),
    expected: true,
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
    actual: (['free', 'included', 'premium', null] as const).map(
      aiJudgeSeatable,
    ),
    expected: [true, true, false, false],
  });
});
