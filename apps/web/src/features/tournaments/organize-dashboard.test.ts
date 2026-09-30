import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getOrganizeDashboard, phaseCounts } from './organize-dashboard';

setupRitewayBun();

describe('getOrganizeDashboard', () => {
  test('the sample organizer’s tournaments, counts and attention', () => {
    const dashboard = getOrganizeDashboard();
    assert({
      given: 'the sample organizer',
      should: 'list four tournaments, count three phases and raise three items',
      actual: [
        dashboard.tournaments.map((item) => item.name),
        dashboard.counts,
        dashboard.attention.length,
      ],
      expected: [
        ['Harvest Cup', 'Autumn Open', 'Winter Open', 'Summer Invitational'],
        [
          { label: 'In progress', count: 1 },
          { label: 'Open for registration', count: 1 },
          { label: 'Drafts', count: 1 },
        ],
        3,
      ],
    });
  });

  test('each tournament has one action into its own place', () => {
    assert({
      given: 'the four tournaments',
      should: 'open a console, manage, continue setup and view results',
      actual: getOrganizeDashboard().tournaments.map(
        (item) => `${item.action.label} -> ${item.action.href}`,
      ),
      expected: [
        'Open console -> /tournaments/organize/harvest-cup',
        'Manage -> /tournaments/organize/autumn-open',
        'Continue setup -> /tournaments/organize/new',
        'View results -> /tournaments/summer-invitational/results',
      ],
    });
  });
});

describe('phaseCounts', () => {
  test('completed tournaments are not counted', () => {
    assert({
      given: 'no tournaments',
      should: 'count zero in every phase',
      actual: phaseCounts([]).map((item) => item.count),
      expected: [0, 0, 0],
    });
  });
});
