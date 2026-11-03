import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { audienceShownTo } from './seated-audience';

setupRitewayBun();

const seat = (
  over: Partial<Parameters<typeof audienceShownTo>[0] & object>,
) => ({
  role: 'affirmative',
  competitionType: 'casual' as const,
  roundEnded: false,
  debatersReadChat: true,
  ...over,
});

describe('audienceShownTo', () => {
  test('anyone with no seat sees everything', () => {
    assert({
      given: 'no seat',
      should: 'show chat, reactions and the count',
      actual: audienceShownTo(null),
      expected: { chat: true, reactions: true, viewers: true },
    });
  });

  test('a non-ranked debater reads chat unless the host turned it off', () => {
    assert({
      given: 'a debater during a non-ranked Round, chat on and then off',
      should: 'show chat only when on, and never reactions or the count',
      actual: [
        audienceShownTo(seat({})),
        audienceShownTo(seat({ debatersReadChat: false })),
      ],
      expected: [
        { chat: true, reactions: false, viewers: false },
        { chat: false, reactions: false, viewers: false },
      ],
    });
  });

  test('a ranked debater never reads it, whatever is stored', () => {
    assert({
      given: 'a debater during a ranked Round with the column wrongly on',
      should: 'show nothing',
      actual: audienceShownTo(
        seat({ competitionType: 'ranked', debatersReadChat: true }),
      ),
      expected: { chat: false, reactions: false, viewers: false },
    });
  });

  test('a judge reads nothing during the Round', () => {
    assert({
      given: 'a judge on a non-ranked Round with chat on',
      should: 'show nothing',
      actual: audienceShownTo(seat({ role: 'judge' })),
      expected: { chat: false, reactions: false, viewers: false },
    });
  });

  test('after the Round a seat reads like anyone', () => {
    assert({
      given: 'a ranked seat once the Round has ended',
      should: 'show everything',
      actual: audienceShownTo(
        seat({ competitionType: 'ranked', roundEnded: true }),
      ),
      expected: { chat: true, reactions: true, viewers: true },
    });
  });
});
