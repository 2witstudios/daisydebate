import { assert, setupRitewayBun, test } from 'riteway/bun';
import { planActions } from './plan-actions';
setupRitewayBun();

test('planActions', () => {
  const closed = planActions({ clubSeats: false, leagueRequests: false });
  assert({
    given: 'Club seats and League requests not yet released',
    should:
      'send Premium to billing checkout and Host to /host, and show Club and League as coming soon',
    actual: closed,
    expected: {
      premium: {
        kind: 'link',
        href: '/settings/billing',
        label: 'Get Premium',
      },
      club: { kind: 'coming-soon' },
      host: { kind: 'link', href: '/host', label: 'Host a tournament' },
      league: { kind: 'coming-soon' },
    },
  });
  const open = planActions({ clubSeats: true, leagueRequests: true });
  assert({
    given: 'both released',
    should: 'link Club to /clubs/new and League to its contact form',
    actual: [open.club, open.league],
    expected: [
      { kind: 'link', href: '/clubs/new', label: 'Start a Club' },
      { kind: 'link', href: '/contact/league', label: 'Talk to us' },
    ],
  });
  assert({
    given: 'only one released',
    should: 'decide each plan by its own flag',
    actual: [
      planActions({ clubSeats: true, leagueRequests: false }).league.kind,
      planActions({ clubSeats: false, leagueRequests: true }).club.kind,
    ],
    expected: ['coming-soon', 'coming-soon'],
  });
});
