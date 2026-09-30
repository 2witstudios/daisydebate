import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from './get-tournament';
import { registrationPanel } from './panel';

setupRitewayBun();

const panel = (id: string, signedIn = true) => {
  const view = getTournament(id, signedIn);
  if (!view) throw new Error(`no sample tournament ${id}`);
  return registrationPanel(view);
};

const ctaLabels = (id: string, signedIn = true) =>
  panel(id, signedIn).ctas.map((cta) =>
    cta.kind === 'link' ? `${cta.label} -> ${cta.href}` : `inert ${cta.id}`,
  );

describe('registrationPanel', () => {
  test('open: eligibility checks and the register link', () => {
    const open = panel('weeknight-sprint');
    assert({
      given: 'an open tournament',
      should: 'show the close time, three checks, Register and judge links',
      actual: [
        open.headline,
        open.body,
        open.checks,
        ctaLabels('weeknight-sprint'),
      ],
      expected: [
        'Registration open',
        'Closes Tue 13 Oct, 18:00 UTC.',
        [
          'You have a username and a rating',
          'Open to any rating',
          'No judging conflict on record',
        ],
        [
          'Register -> /tournaments/enter/weeknight-sprint',
          'Volunteer to judge instead -> /judge',
        ],
      ],
    });
  });

  test('a rating band shows in the checks', () => {
    assert({
      given: 'a tournament for ratings 1000 to 1400',
      should: 'name the band',
      actual: panel('bronze-cup').checks[1],
      expected: 'Open to ratings 1000 to 1400',
    });
  });

  test('registered: first round, calendar and withdraw', () => {
    const registered = panel('autumn-open');
    assert({
      given: 'the viewer registered in Autumn Open',
      should:
        'show the first round with check-in, an inert calendar and Withdraw',
      actual: [
        registered.headline,
        registered.firstRound,
        registered.callout?.includes('Thu 8 Oct, 19:00 UTC'),
        ctaLabels('autumn-open'),
      ],
      expected: [
        'You are registered',
        'Sat 10 Oct, 14:00 UTC (check-in 13:50)',
        true,
        [
          'inert calendar',
          'Withdraw -> /tournaments/enter/autumn-open/withdraw',
        ],
      ],
    });
  });

  test('full and waitlisted', () => {
    assert({
      given: 'a full tournament and the viewer waitlisted at 2',
      should: 'offer to join, then to leave, the waitlist',
      actual: [
        panel('night-owl-open').body,
        ctaLabels('night-owl-open'),
        panel('novice-cup').headline,
        ctaLabels('novice-cup'),
      ],
      expected: [
        'All 8 places are taken and 2 people are waiting. If someone withdraws, the first person on the waitlist is entered and told straight away.',
        ['Join the waitlist -> /tournaments/enter/night-owl-open'],
        'Waitlisted, position 2',
        ['Leave the waitlist -> /tournaments/enter/novice-cup/withdraw'],
      ],
    });
  });

  test('signed out sends sign-in through the entry flow', () => {
    assert({
      given: 'an anonymous visitor on an open tournament',
      should: 'offer Sign in to register and say browsing needs no account',
      actual: [
        ctaLabels('autumn-open', false),
        panel('autumn-open', false).callout,
      ],
      expected: [
        [
          'Sign in to register -> /sign-in?next=%2Ftournaments%2Fenter%2Fautumn-open',
        ],
        'You can browse the entrants and rules without an account.',
      ],
    });
  });

  test('the later lifecycle states', () => {
    assert({
      given:
        'closed, not open, in progress, competing and completed tournaments',
      should:
        'point at the bracket, an inert reminder, my event or the results',
      actual: [
        ctaLabels('hollow-cup'),
        ctaLabels('winter-open'),
        ctaLabels('club-championship'),
        ctaLabels('harvest-cup'),
        ctaLabels('summer-invitational'),
      ],
      expected: [
        ['Follow this tournament -> /tournaments/hollow-cup/bracket'],
        ['inert remind'],
        ['Follow this tournament -> /tournaments/club-championship/bracket'],
        [
          'Open my event -> /tournaments/mine/harvest-cup',
          'Follow the bracket -> /tournaments/harvest-cup/bracket',
        ],
        ['See results -> /tournaments/summer-invitational/results'],
      ],
    });
  });
});
