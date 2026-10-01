import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { driveMatch, screenFor } from './drive-match';
import { defaultRankedQuery } from './ranked-query';
import { testSources } from './ranked.test-support';

setupRitewayBun();

const sources = {
  ...testSources(),
  standing: {
    rating: { kind: 'established', value: 1586 },
    season: { number: 3, daysLeft: 41 },
  },
  opponent: { handle: 'rival', rating: 1500, status: 'provisional' },
} as const;

const at = (step: Parameters<typeof screenFor>[0]['step']) =>
  screenFor({ step, rules: false }, sources);

describe('screenFor', () => {
  test('the hub links to search, the rules and hosting', () => {
    const hub = screenFor(defaultRankedQuery, sources);
    assert({
      given: 'the hub',
      should: 'carry the standing, four rules and the three links',
      actual:
        hub.step === 'hub'
          ? [
              hub.standing.rating,
              hub.rules.length,
              hub.rulesOpen,
              hub.findMatchHref,
              hub.openRulesHref,
              hub.closeRulesHref,
              hub.hostHref,
            ]
          : null,
      expected: [
        { kind: 'established', value: 1586 },
        4,
        false,
        '/ranked?step=search',
        '/ranked?rules=1',
        '/ranked',
        '/ranked/host',
      ],
    });
  });

  test('the rules drawer opens from the query', () => {
    const hub = screenFor({ step: 'hub', rules: true }, sources);
    assert({
      given: 'the hub with the rules flag',
      should: 'open the drawer',
      actual: hub.step === 'hub' && hub.rulesOpen,
      expected: true,
    });
  });

  test('searching can be cancelled and moves on to the offer', () => {
    assert({
      given: 'the search step',
      should: 'cancel to the hub and advance to the offer',
      actual: at('search'),
      expected: {
        step: 'search',
        cancelHref: '/ranked',
        advance: { afterSeconds: 5, href: '/ranked?step=offer' },
      },
    });
  });

  test('an offer is accepted, declined or times out', () => {
    assert({
      given: 'the offer step',
      should: 'accept to waiting, decline to ended and time out to ended',
      actual: at('offer'),
      expected: {
        step: 'offer',
        opponent: sources.opponent,
        respondSeconds: 20,
        acceptHref: '/ranked?step=waiting',
        declineHref: '/ranked?step=ended',
        advance: { afterSeconds: 20, href: '/ranked?step=ended' },
      },
    });
  });

  test('waiting, ready and entering reach the room', () => {
    assert({
      given: 'waiting, ready and entering',
      should: 'advance to ready, entering and the existing /play shell',
      actual: [at('waiting'), at('ready'), at('entering')].map((screen) =>
        'advance' in screen ? screen.advance.href : null,
      ),
      expected: ['/ranked?step=ready', '/ranked?step=entering', '/play'],
    });
  });

  test('entering offers the room now', () => {
    const entering = at('entering');
    assert({
      given: 'the entering step',
      should: 'link Enter room to /play',
      actual: entering.step === 'entering' && entering.enterHref,
      expected: '/play',
    });
  });

  test('ended restarts or goes back and never names who declined', () => {
    const ended = at('ended');
    assert({
      given: 'the ended step',
      should: 'offer a new search or the hub, with no opponent and no advance',
      actual: ended,
      expected: {
        step: 'ended',
        restartHref: '/ranked?step=search',
        backHref: '/ranked',
      },
    });
  });
});

describe('driveMatch', () => {
  test('plays the sample flow', () => {
    const offer = driveMatch({ step: 'offer', rules: false });
    assert({
      given: 'the offer step over the sample data',
      should: 'show the sample opponent',
      actual: offer.step === 'offer' && offer.opponent.handle,
      expected: 'debater-b',
    });
  });
});
