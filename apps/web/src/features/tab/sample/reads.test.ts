import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { landingStop } from '../tournament';
import { sampleJudgeBallot } from './ballot';
import { AUTUMN, VARSITY } from './moment';
import { sampleTimelineRail } from './rail';
import { sampleRoom } from './rooms';
import type { SampleScene } from './scene';
import { sampleSetup } from './setup';
import { sampleRunningRound } from './tab-round';
import { sampleTournamentPage } from './tournament';

setupRitewayBun();

const host: SampleScene = { viewer: 'host', moment: 'break' };
const judge: SampleScene = { viewer: 'judge', moment: 'break' };
const inherited = ['constructor', '__proto__', 'toString'];

describe('the sample reads', () => {
  test('an address naming something every object inherits', () => {
    assert({
      given: 'a round, a Room and a ballot named constructor and the like',
      should: 'answer that there is no such thing',
      actual: inherited.flatMap((name) => [
        sampleRunningRound(AUTUMN, VARSITY, name, host),
        sampleRoom(name, host),
        sampleJudgeBallot(name, judge),
      ]),
      expected: inherited.flatMap(() => [null, null, null]),
    });
  });

  test('a round or an event the tournament does not have', () => {
    const page = (event: string, round: string) =>
      sampleTournamentPage(AUTUMN, { kind: 'round', event, round }, host)
        ?.kind ?? null;
    assert({
      given: 'the posting of round 3, of round 99 and of another event',
      should: 'answer for the round that is posted and for nothing else',
      actual: [page(VARSITY, '3'), page(VARSITY, '99'), page('anything', '3')],
      expected: ['rounds', null, null],
    });
  });

  test('what the league enforces on a tournament', () => {
    const locked = sampleSetup(AUTUMN, host)
      ?.settings.filter((setting) => setting.control.kind === 'locked')
      .map((setting) => [setting.label, setting.source.scope]);
    assert({
      given: 'setup of a tournament started from an enforcing template',
      should:
        'hold format, ballot, tiebreaks and recording locked, set by the league',
      actual: locked,
      expected: [
        ['Format', 'organization'],
        ['Ballot', 'organization'],
        ['Tiebreaks', 'organization'],
        ['Recording', 'organization'],
      ],
    });
  });

  test('opening a certified tournament', () => {
    const rail = sampleTimelineRail(AUTUMN, {
      viewer: 'host',
      moment: 'finished',
    });
    assert({
      given: 'the host opening Autumn Open once it is certified',
      should: 'land on its results',
      actual: rail === null ? null : landingStop(rail),
      expected: '/host/tournaments/autumn-open/results',
    });
  });
});
