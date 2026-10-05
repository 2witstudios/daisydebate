import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from '../../../features/tournaments/tournament.test-support';
import { roomFlow, type RoomState } from '../../../features/tournaments/room';
import { sampleEvent } from '../../mock/tournament-events';
import { RoomPage } from './room-page';

setupRitewayBun();

const data = sampleEvent(NOW);
if (!data) throw new Error('no sample event');
const render = (state: RoomState) =>
  renderToString(
    h(RoomPage, {
      screen: roomFlow(data, state),
      tournament: data.tournament,
      startsAt: data.pairing.startsAt,
    }),
  );

describe('RoomPage', () => {
  test('not ready: a link to ready, both seats and the judge', () => {
    const html = render('not-ready');
    assert({
      given: 'the viewer not ready',
      should:
        'name the room, seats, judge and link I am ready to the ready state',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Semifinal 1 room'),
        html.includes('Tournament debate'),
        html.includes('Affirmative'),
        html.includes('Negative'),
        html.includes('@judge-k'),
        /href="\/tournaments\/mine\/harvest-cup\/room\/semifinal-1\?state=ready"[^>]*>I am ready</.test(
          html,
        ),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('ready waits for the opponent', () => {
    assert({
      given: 'the viewer ready',
      should: 'say waiting for the opponent',
      actual: render('ready').includes('Waiting for @debater-c'),
      expected: true,
    });
  });

  test('starting announces the countdown', () => {
    assert({
      given: 'both ready',
      should: 'show the status line',
      actual: /role="status"[^>]*>Starting in 5 seconds</.test(
        render('starting'),
      ),
      expected: true,
    });
  });

  test('an absent opponent: forfeit is disabled until the window opens', () => {
    const html = render('absent');
    assert({
      given: 'the opponent has not checked in',
      should: 'explain the forfeit window and disable the claim',
      actual: [
        html.includes('@debater-c has not checked in.'),
        /<button type="button" disabled=""[^>]*>Claim forfeit \(available 12:28\)</.test(
          html,
        ),
        html.includes('Not checked in'),
      ],
      expected: [true, true, true],
    });
  });

  test('the rules card carries the fixed facts', () => {
    const html = render('not-ready');
    assert({
      given: 'the rules aside',
      should: 'say standard rules, unrated and fixed seats',
      actual: [
        html.includes('aria-label="Rules for this debate"'),
        html.includes('Standard'),
        html.includes('>Unrated<'),
        html.includes('Fixed'),
        html.includes('31 watching, public'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
