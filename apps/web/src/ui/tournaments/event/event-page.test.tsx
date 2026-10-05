import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  eventFlow,
  eventMoments,
  type EventMoment,
} from '../../../features/tournaments/event';
import { NOW } from '../../../features/tournaments/tournament.test-support';
import { sampleEvent } from '../../mock/tournament-events';
import { EventPage, NotInEvent } from './event-page';

setupRitewayBun();

const data = sampleEvent(NOW);
if (!data) throw new Error('no sample event');
const render = (moment: EventMoment) =>
  renderToString(
    h(EventPage, {
      screen: eventFlow(data, moment, NOW),
      tournament: data.tournament,
      finalAt: data.final.startsAt,
    }),
  );

describe('EventPage', () => {
  test('every moment renders one h1, a polite hero, the path and the rounds', () => {
    assert({
      given: 'each moment',
      should: 'keep the same landmarks',
      actual: eventMoments.map((moment) => {
        const html = render(moment);
        return [
          html.match(/<h1 /g)?.length,
          html.includes('aria-live="polite"'),
          html.includes('aria-label="Your path"'),
          html.includes('Your rounds'),
          html.includes('aria-label="Your tournaments"'),
        ];
      }),
      expected: eventMoments.map(() => [1, true, true, true, true]),
    });
  });

  test('pairing out: the four cards and disabled check-in', () => {
    const html = render('released');
    assert({
      given: 'the released moment',
      should: 'show opponent, side, room and judge, and a disabled check-in',
      actual: [
        html.includes('Your opponent'),
        html.includes('@debater-c'),
        html.includes('Negative'),
        html.includes('Harvest Cup, Semifinal 1'),
        html.includes('@judge-k'),
        /<button type="button" disabled=""[^>]*>Check in \(opens 12:08\)</.test(
          html,
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('check-in links to the room', () => {
    assert({
      given: 'the check-in moment',
      should: 'link Check in and open room',
      actual:
        /href="\/tournaments\/mine\/harvest-cup\/room\/semifinal-1"[^>]*>Check in and open room</.test(
          render('checkin'),
        ),
      expected: true,
    });
  });

  test('won shows the reason placeholder; lost offers the next event', () => {
    assert({
      given: 'a win and a loss',
      should: 'show the reason box, then Find the next event',
      actual: [
        render('won').includes('Reason for decision'),
        render('lost').includes('Find the next event'),
        render('lost').includes('equal third'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('NotInEvent', () => {
  test('a tournament the viewer is not in, and an unknown one', () => {
    const known = renderToString(
      h(NotInEvent, { tournament: data.tournament }),
    );
    const unknown = renderToString(h(NotInEvent, { tournament: null }));
    assert({
      given: 'a known and an unknown tournament',
      should: 'explain and link back',
      actual: [
        known.includes('You are not competing in Harvest Cup'),
        known.includes('href="/tournaments/harvest-cup"'),
        unknown.includes('We could not find that event'),
        unknown.includes('href="/tournaments"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
