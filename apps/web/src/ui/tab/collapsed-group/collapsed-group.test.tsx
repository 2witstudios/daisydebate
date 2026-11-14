import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { collapsed } from '../../../features/tab/at-scale';
import { WithAppRouter } from '../../test-support/app-router';
import { CollapsedRow, collapsedTitle } from './collapsed-group';

setupRitewayBun();

const render = (element: React.ReactElement) =>
  renderToStaticMarkup(<WithAppRouter>{element}</WithAppRouter>);

const rooms = Array.from({ length: 34 }, (_, n) => n);

describe('CollapsedRow', () => {
  test('a long group ends in a counted row with a button', () => {
    const html = render(
      <ul>
        <CollapsedRow
          group={collapsed(rooms, { limit: 3, open: false })}
          noun="judging"
          detail="The newest ballot opened a minute ago"
          href="/host/r?open=judging"
        />
      </ul>,
    );
    assert({
      given: '34 judging rooms cut to three, with the address that opens them',
      should:
        'say how many more, link "Show all 34" drawn as a button named for the group, and never underline it',
      actual: [
        collapsedTitle(31, 'judging'),
        html.includes('31 more judging'),
        html.includes('The newest ballot opened a minute ago'),
        html.includes('href="/host/r?open=judging"'),
        html.includes('aria-label="Show all 34: judging"'),
        />Show all 34</.test(html),
        [...html.matchAll(/class="([^"]*)"/g)].some((match) =>
          (match[1] ?? '').split(' ').includes('underline'),
        ),
      ],
      expected: ['31 more judging', true, true, true, true, true, false],
    });
  });

  test('a group shown whole has no counted row', () => {
    assert({
      given:
        'the same group opened, and a group with no address and its own label',
      should: 'render nothing; answer as a sample action labelled as asked',
      actual: [
        render(
          <CollapsedRow
            group={collapsed(rooms, { limit: 3, open: true })}
            noun="judging"
            href="/x"
          />,
        ),
        render(
          <ul>
            <CollapsedRow
              group={collapsed(rooms.slice(0, 7), { limit: 0, open: false })}
              noun="fixtures on 4 wins"
              href={null}
              label="Show 7"
            />
          </ul>,
        ).includes('>Show 7<'),
      ],
      expected: ['', true],
    });
  });
});
