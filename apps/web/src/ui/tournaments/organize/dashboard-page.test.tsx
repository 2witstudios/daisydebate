import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getOrganizeDashboard } from '../../../features/tournaments/organize-dashboard';
import { DashboardPage } from './dashboard-page';

setupRitewayBun();

describe('DashboardPage', () => {
  test('counts, tournaments, attention and the league note', () => {
    const html = renderToString(
      h(DashboardPage, { dashboard: getOrganizeDashboard() }),
    );
    assert({
      given: 'the sample organizer',
      should:
        'show one h1, three counts, four tournaments with actions and three attention items',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('href="/tournaments/organize/new"'),
        html.match(/<li class="flex flex-col gap-1 rounded-lg border/g)?.length,
        html.includes('aria-label="Your tournaments"'),
        /href="\/tournaments\/organize\/harvest-cup"[^>]*>Open console</.test(
          html,
        ),
        /href="\/tournaments\/organize\/autumn-open"[^>]*>Manage</.test(html),
        /href="\/tournaments\/organize\/new"[^>]*>Continue setup</.test(html),
        /href="\/tournaments\/summer-invitational\/results"[^>]*>View results</.test(
          html,
        ),
        html.includes('Harvest Cup: ballot missing'),
        html.includes('Autumn Open: judges needed'),
        html.includes('Running a league?'),
        html.includes('never by the organizer'),
      ],
      expected: [
        1,
        true,
        3,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
      ],
    });
  });

  test('an organizer with nothing yet', () => {
    const html = renderToString(
      h(DashboardPage, {
        dashboard: { counts: [], tournaments: [], attention: [] },
      }),
    );
    assert({
      given: 'no tournaments',
      should: 'still offer to create one',
      actual: html.includes('Create a tournament'),
      expected: true,
    });
  });
});
