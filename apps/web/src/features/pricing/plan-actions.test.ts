import { assert, setupRitewayBun, test } from 'riteway/bun';
import { planActions, type PlanReleases } from './plan-actions';
setupRitewayBun();

const none: PlanReleases = {
  premiumCheckout: false,
  tabHosting: false,
  clubSeats: false,
  leagueRequests: false,
};
const all: PlanReleases = {
  premiumCheckout: true,
  tabHosting: true,
  clubSeats: true,
  leagueRequests: true,
};

test('planActions', () => {
  assert({
    given: 'every destination released',
    should:
      'send Premium to billing checkout, Club to /clubs/new, Host to /host and League to its contact form',
    actual: planActions(all),
    expected: {
      premium: {
        kind: 'link',
        href: '/settings/billing',
        label: 'Get Premium',
      },
      club: { kind: 'link', href: '/clubs/new', label: 'Start a Club' },
      host: { kind: 'link', href: '/host', label: 'Host a tournament' },
      league: { kind: 'link', href: '/contact/league', label: 'Talk to us' },
    },
  });
  assert({
    given: 'no destination released',
    should: 'show every plan as coming soon, with no link',
    actual: Object.values(planActions(none)).map((action) => action.kind),
    expected: ['coming-soon', 'coming-soon', 'coming-soon', 'coming-soon'],
  });
  const kinds = (releases: PlanReleases) => {
    const actions = planActions(releases);
    return [
      actions.premium.kind,
      actions.club.kind,
      actions.host.kind,
      actions.league.kind,
    ];
  };
  assert({
    given: 'one destination released at a time',
    should: 'open only the plan that flag owns',
    actual: [
      kinds({ ...none, premiumCheckout: true }),
      kinds({ ...none, clubSeats: true }),
      kinds({ ...none, tabHosting: true }),
      kinds({ ...none, leagueRequests: true }),
    ],
    expected: [
      ['link', 'coming-soon', 'coming-soon', 'coming-soon'],
      ['coming-soon', 'link', 'coming-soon', 'coming-soon'],
      ['coming-soon', 'coming-soon', 'link', 'coming-soon'],
      ['coming-soon', 'coming-soon', 'coming-soon', 'link'],
    ],
  });
});
