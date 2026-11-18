import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LadderBadge } from './ladder-badge';

setupRitewayBun();

describe('ladder badges', () => {
  test('each division', () => {
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
  });
});
