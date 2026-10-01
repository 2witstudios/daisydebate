import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTeam } from './get-team';
import { parseTeamQuery, teamHref, teamView } from './team-view';

setupRitewayBun();

const team = (() => {
  const found = getTeam('sample-team');
  if (found === undefined) throw new Error('missing sample');
  return found;
})();

describe('team query', () => {
  test('tabs and junk', () => {
    assert({
      given: 'a tab, nothing and junk',
      should: 'read the tab or fall back to shared items',
      actual: [
        parseTeamQuery({ tab: 'members' }).tab,
        parseTeamQuery({}).tab,
        parseTeamQuery({ tab: 'billing' }).tab,
        teamHref('t', 'items'),
        teamHref('t', 'activity'),
      ],
      expected: [
        'members',
        'items',
        'items',
        '/prep/teams/t',
        '/prep/teams/t?tab=activity',
      ],
    });
  });
});

describe('teamView', () => {
  const view = teamView(team, { tab: 'items' });

  test('tabs carry real counts', () => {
    assert({
      given: 'the sample team',
      should: 'count the shared items and the members it actually lists',
      actual: view.tabs.map((t) => [t.label, t.count ?? null]),
      expected: [
        ['Shared items', 5],
        ['Members', 4],
        ['Activity', null],
      ],
    });
  });

  test('items say who shared them and who may change them', () => {
    assert({
      given: 'items shared by the viewer and by others',
      should: 'let only the sharer change the permission',
      actual: view.items.map((i) => [i.subtitle, i.canChange]),
      expected: [
        ['Shared by You · 2 days ago', true],
        ['Shared by You · 2 days ago', true],
        ['Shared by @debater-b · Last week', false],
        ['Shared by You · Last week', true],
        ['Shared by @debater-d · 3 weeks ago', false],
      ],
    });
  });

  test('members, admin and the invitation line', () => {
    assert({
      given: 'the viewer is the team admin',
      should: 'mark the viewer and keep the expiry a placeholder',
      actual: [
        view.members[0]?.label,
        view.members[1]?.label,
        view.isAdmin,
        view.pendingLine,
      ],
      expected: [
        '@debater-a (you)',
        '@debater-b',
        true,
        '2 invitations pending. Invitations expire after [7] days.',
      ],
    });
  });
});
