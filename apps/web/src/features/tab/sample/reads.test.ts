import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  landingStop,
  readTimelineRail,
  readTournamentPage,
  readTournamentsIndex,
} from '../tournament';
import { sampleJudgeBallot } from './ballot';
import { readLeagueLobby } from '../league';
import { AUTUMN, IMPROMPTU, LEAGUE, VARSITY } from './moment';
import { readRoom } from '../room';
import type { SampleScene } from './scene';
import { readSetup } from '../setup';
import { readRunningRound } from '../tab-round';

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
        readRunningRound(AUTUMN, VARSITY, name, host),
        readRoom(name, host),
        sampleJudgeBallot(name, judge),
      ]),
      expected: inherited.flatMap(() => [null, null, null]),
    });
  });

  test('a round or an event the tournament does not have', () => {
    const page = (event: string, round: string) =>
      readTournamentPage(AUTUMN, { kind: 'round', event, round }, host)?.kind ??
      null;
    assert({
      given: 'the posting of round 3, of round 99 and of another event',
      should: 'answer for the round that is posted and for nothing else',
      actual: [page(VARSITY, '3'), page(VARSITY, '99'), page('anything', '3')],
      expected: ['rounds', null, null],
    });
  });

  test('what the league enforces on a tournament', () => {
    const locked = readSetup(AUTUMN, host)
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
    const rail = readTimelineRail(AUTUMN, {
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

  test('a visitor reads Autumn Open by whether it has begun', () => {
    const groupOf = (scene: SampleScene) =>
      readTournamentsIndex(scene).groups.find((group) =>
        group.rows.some((row) => row.name === 'Autumn Open'),
      )?.heading ?? null;
    assert({
      given: 'a visitor before the tournament and during prelims',
      should: 'list it as open to enter, then as on now',
      actual: [
        groupOf({ viewer: 'visitor', moment: 'before' }),
        groupOf({ viewer: 'visitor', moment: 'prelims' }),
      ],
      expected: ['Open to enter', 'On now'],
    });
  });

  test("the speech round offers the final's draw only between rounds and elims", () => {
    const next = (moment: SampleScene['moment']) =>
      readRunningRound(AUTUMN, IMPROMPTU, '3', { viewer: 'host', moment })?.next
        ?.label ?? null;
    assert({
      given:
        'Impromptu round 3 while running, at the break, in elims and finished',
      should: "offer the final's draw at the break alone",
      actual: [next('prelims'), next('break'), next('elims'), next('finished')],
      expected: [null, "Open the final's draw", null, null],
    });
  });

  test('a season event the league does not have', () => {
    const event = (name: string | null) => {
      const panel = readLeagueLobby(
        LEAGUE,
        { tab: 'season', event: name },
        host,
      )?.panel;
      return panel?.kind === 'season' ? panel.event : null;
    };
    assert({
      given: 'no event, and an event name the league does not run',
      should: 'show the default event rather than no lobby',
      actual: [event(null), event('lincoln-douglas')],
      expected: [VARSITY, VARSITY],
    });
  });
});
