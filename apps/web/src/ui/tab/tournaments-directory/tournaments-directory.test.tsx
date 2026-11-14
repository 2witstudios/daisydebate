import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readTournamentsIndex } from '../../../features/tab/tournaments-index';
import { WithAppRouter } from '../../test-support/app-router';
import { TournamentsDirectory } from './tournaments-directory';

setupRitewayBun();

const competitor = {
  viewer: 'competitor',
  moment: 'prelims',
  scale: 'normal',
} as const;

const render = (params: Record<string, string>) =>
  renderToStaticMarkup(
    <WithAppRouter>
      <TournamentsDirectory index={readTournamentsIndex(competitor, params)} />
    </WithAppRouter>,
  );

/** Every anchor's classes, for the rule that an action is never underlined. */
const underlined = (html: string) =>
  [...html.matchAll(/<a [^>]*class="([^"]*)"/g)]
    .map((match) => match[1] ?? '')
    .filter((classes) => / underline( |$)|^underline /.test(classes));

describe('TournamentsDirectory', () => {
  test('the list', () => {
    const html = render({ division: 'varsity', open: '1' });
    assert({
      given: 'a competitor filtering for varsity with entry open',
      should:
        "pin You're in with Open buttons, then the tabs, search, Filters 2, the chips and a page of twenty",
      actual: [
        html.includes('You&#x27;re in'),
        html.includes('aria-label="Open: Autumn Open"'),
        html.includes('aria-label="Open: Winter Classic"'),
        html.includes('Upcoming'),
        html.includes('Live now'),
        html.includes('placeholder="Tournament, league or school"'),
        /Filters<span[^>]*>2<\/span>/.test(html),
        html.includes('aria-label="Varsity: remove"'),
        html.includes('aria-label="Entry open: remove"'),
        html.includes('href="/tournaments"'),
        /20 of \d+ shown/.test(html),
        html.includes('Show 20 more'),
        /Show \d+ tournaments/.test(html),
        html.includes('Clear all'),
      ],
      expected: Array.from({ length: 14 }, () => true),
    });
    assert({
      given: 'every link on the list',
      should: 'draw none as an underlined text link',
      actual: underlined(html),
      expected: [],
    });
  });

  test('the calendar', () => {
    const html = render({ view: 'calendar', day: '2026-11-21' });
    assert({
      given: 'the calendar with Saturday 21 Nov picked',
      should:
        "show the month, link a day by its count, and list the day's first five with Show all",
      actual: [
        html.includes('November 2026'),
        html.includes('aria-label="Next month"'),
        html.includes('aria-current="date"'),
        /aria-label="20 November, \d+ tournaments?"/.test(html),
        html.includes('Sat 21 Nov'),
        /5 of \d+ shown/.test(html),
        /Show all \d+/.test(html),
        html.includes('You&#x27;re in'),
      ],
      expected: [true, true, true, true, true, true, true, false],
    });
  });
});
