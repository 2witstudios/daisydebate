import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialDrill } from '../../../features/train/drill';
import {
  drillScreen,
  parseDrillQuery,
} from '../../../features/train/drill-view';
import { Drill } from './drill';

setupRitewayBun();

describe('Drill', () => {
  test('the page around the form', () => {
    const html = renderToString(
      <Drill
        screen={drillScreen(parseDrillQuery({ kind: 'responding' }))}
        action={async () => initialDrill}
      />,
    );
    assert({
      given: 'the responding drill',
      should: 'title it, show what the check looks for and the session round',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Responding drill'),
        html.includes('What the check looks for'),
        html.includes('It does not decide whether you are right.'),
        html.includes('Round'),
        html.includes('1 of 2'),
        html.includes('href="/train"'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });
});
