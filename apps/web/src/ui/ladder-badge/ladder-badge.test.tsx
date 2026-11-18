import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DivisionBadge, LadderBadge, SeatedLadderBadge } from './ladder-badge';

setupRitewayBun();

describe('ladder badges', () => {
  test('each division and seating', () => {
    const youth = renderToString(
      <LadderBadge ladder={{ style: 'freestyle', division: 'youth' }} />,
    );
    const open = renderToString(
      <LadderBadge ladder={{ style: 'freestyle', division: 'open' }} />,
    );
    assert({
      given: 'the Youth and the Open Freestyle ladders',
      should: 'name each ladder, Youth in plum and Open in the accent',
      actual: [
        youth.includes('Youth – Freestyle'),
        youth.includes('hue-plum'),
        open.includes('Open – Freestyle'),
        open.includes('accent'),
      ],
      expected: [true, true, true, true],
    });
    assert({
      given: 'a ranked Room no debater has set, one that mixes, and a debater',
      should:
        'say the ladder is set by who sits, that it plays casual, and name the division',
      actual: [
        renderToString(<SeatedLadderBadge seated="unset" />).includes(
          'Ladder set by who sits',
        ),
        renderToString(<SeatedLadderBadge seated="mixed" />).includes(
          'Plays casual · mixed ladders',
        ),
        renderToString(<DivisionBadge division="youth" />).includes('Youth'),
      ],
      expected: [true, true, true],
    });
  });
});
