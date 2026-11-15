import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SampleScene } from '../../features/tab/sample/scene';
import { WithAppRouter } from '../test-support/app-router';
import { sampleAnswer } from './sample-screens.test-support';

setupRitewayBun();
const render = (
  path: string,
  moment: SampleScene['moment'] = 'prelims',
  viewer: SampleScene['viewer'] = 'host',
) => {
  const answer = sampleAnswer(path, { viewer, moment, scale: 'large' });
  return answer.kind === 'screen'
    ? renderToStaticMarkup(<WithAppRouter>{answer.element}</WithAppRouter>)
    : answer.kind;
};
describe('Tab screens at scale', () => {
  test('the running round merges needs, caps groups and offers search', () => {
    const html = render(
      '/host/tournaments/autumn-open/events/varsity-debate/rounds/3',
    );
    assert({
      given: '100 rooms including six overdue ballots',
      should:
        'merge overdue ballots and collapse long groups with a working disclosure',
      actual: [
        html.includes('6 ballots are overdue'),
        html.includes('Find a room, entry or judge'),
        html.includes('Show all 40'),
        html.includes('<details'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('the draw keeps findings first, collapses record groups and pins why', () => {
    const html = render(
      '/host/tournaments/autumn-open/events/varsity-debate/rounds/4?fixture=doyle-sato',
    );
    assert({
      given: 'the large draft draw',
      should: 'offer search, look first and a sticky explanation',
      actual: [
        html.includes('Look first'),
        html.includes('Find an entry, school or judge'),
        html.includes('sticky'),
        html.includes('<details'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('entries and judges remain short and searchable', () => {
    const entries = render('/host/tournaments/autumn-open/entries');
    const judges = render('/host/tournaments/autumn-open/judges');
    assert({
      given: '60 schools and 150 judges',
      should: 'show priorities and searchable collapsed lists',
      actual: [
        entries.includes('Find an entry, school or adult'),
        entries.includes('Needs you'),
        entries.includes('Show all 60'),
        judges.includes('Find a judge or school'),
        judges.includes('<details'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('standings render each break line and results start at the live round', () => {
    const standings = render(
      '/host/tournaments/autumn-open/standings',
      'break',
    );
    const results = render('/host/tournaments/autumn-open/results', 'elims');
    assert({
      given: '200 entries and a bracket of 64',
      should: 'separate main and novice breaks and disclose earlier rounds',
      actual: [
        standings.includes('Main break'),
        standings.includes('Novice break'),
        standings.includes('Show 58'),
        results.includes('Show earlier rounds'),
        results.includes('<details'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('phone postings group by school and keep your school first', () => {
    const visitor = render(
      '/tournaments/autumn-open/events/varsity-debate/rounds/4',
      'prelims',
      'visitor',
    );
    const member = render(
      '/tournaments/autumn-open/events/varsity-debate/rounds/4',
      'prelims',
      'competitor',
    );
    assert({
      given: 'large postings for a visitor and competitor',
      should: 'offer school search and the member own school',
      actual: [
        visitor.includes('Find a name, school or room'),
        visitor.includes('By school'),
        member.includes('Your school'),
        visitor.includes('<details'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('the 120-room slot stays searchable with counted groups', () => {
    const html = render('/host/tournaments/winter-classic/slots/1200');
    assert({
      given: '120 rooms across four events',
      should: 'merge withdrawals, search rooms and disclose long status groups',
      actual: [
        html.includes('3 judges withdrew'),
        html.includes('Find a room, entry or judge'),
        html.includes('Show all 54'),
        html.includes('Show all 34'),
        html.includes('Show all 30'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('index search and calendar are reachable through their actual addresses', () => {
    const list = render('/tournaments?q=no-such-tournament-zz');
    const calendar = render('/tournaments?view=calendar');
    assert({
      given: 'a query matching no tournament and the calendar address',
      should: 'apply the query and draw the calendar',
      actual: [
        list.includes('no-such-tournament-zz'),
        list.includes('No tournaments'),
        calendar.includes('November 2026'),
        calendar.includes('aria-label="Calendar"') ||
          calendar.includes('aria-label="November 2026"'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('standalone actions on a host screen are buttons', () => {
    const html = render('/host/tournaments/autumn-open/entries');
    assert({
      given: 'the host entries actions',
      should: 'render no old underlined action links',
      actual: html.includes('font-strong text-ink underline'),
      expected: false,
    });
  });
});
