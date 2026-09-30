import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTeam } from '../../../features/prep/get-team';
import { teamView, type TeamTab } from '../../../features/prep/team-view';
import { TeamPage } from './team-page';

setupRitewayBun();

const render = (tab: TeamTab) => {
  const team = getTeam('sample-team');
  if (team === undefined) throw new Error('missing sample');
  return renderToString(h(TeamPage, { view: teamView(team, { tab }) }));
};

describe('TeamPage', () => {
  test('shared items', () => {
    const html = render('items');
    assert({
      given: 'the items tab',
      should:
        'list the items as links with permissions, and the privacy and leave cards',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('href="/prep/cases/aff-rights"'),
        html.includes('Shared by @debater-b · Last week'),
        html.includes('Permission for Sources on enforcement'),
        html.includes('What this team can see'),
        html.includes('Leave this team'),
        html.includes('Cannot see: '),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('members', () => {
    const html = render('members');
    assert({
      given: 'the members tab as the admin',
      should:
        'mark the viewer, offer Manage only for others, and the invite field and the expiry placeholder',
      actual: [
        html.includes('@debater-a (you)'),
        html.match(/>Manage</g)?.length,
        html.includes('Invite by @handle'),
        html.includes('expire after [7] days'),
      ],
      expected: [true, 3, true, true],
    });
  });

  test('activity and tab links', () => {
    const html = render('activity');
    assert({
      given: 'the activity tab',
      should: 'show the log and link the tabs with the tab in the URL',
      actual: [
        html.includes('@debater-b saved v2 of Opening statements'),
        html.includes('href="/prep/teams/sample-team?tab=members"'),
        /aria-current="page"[^>]*>Activity/.test(html),
      ],
      expected: [true, true, true],
    });
  });
});
