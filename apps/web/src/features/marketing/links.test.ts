import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceLinks } from './links';
import { closedLinks, openLinks } from './links.test-support';

setupRitewayBun();

test('an audience page links only where a release is open', () => {
  assert({
    given: 'every release open',
    should: 'send each action to its destination',
    actual: openLinks,
    expected: {
      signIn: '/sign-in',
      premiumOpen: true,
      support: '/support',
      pricing: '/pricing',
      addChild: '/settings/parental-controls',
      startClub: '/clubs/new',
      host: '/host',
      league: '/contact/league',
      ncfca: '/ncfca',
      parents: '/parents',
      coach: '/coach',
      leagues: '/leagues',
      tab: '/tab',
    },
  });
  assert({
    given: 'every release closed',
    should:
      'keep only sign-in, support and the NCFCA page, which need none, and sell no Premium',
    actual: Object.entries(closedLinks).filter(([, href]) => href !== null),
    expected: [
      ['signIn', '/sign-in'],
      ['premiumOpen', false],
      ['support', '/support'],
      ['ncfca', '/ncfca'],
    ],
  });
  assert({
    given: 'Club seats open alone',
    should: 'open Start a Club and the coach page, and nothing else gated',
    actual: Object.entries(
      audienceLinks({
        premiumCheckout: false,
        hostTiers: false,
        clubSeats: true,
        leagueRequests: false,
        pricingPage: false,
        parentalControls: false,
      }),
    )
      .filter(([, href]) => href !== null)
      .map(([key]) => key),
    expected: [
      'signIn',
      'premiumOpen',
      'support',
      'startClub',
      'ncfca',
      'coach',
    ],
  });
});
