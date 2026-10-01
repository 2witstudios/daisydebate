import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleEvent } from '../../ui/mock/tournament-events';
import { NOW } from './tournament.test-support';
import {
  eventFlow,
  eventHref,
  eventMoments,
  parseEventMoment,
  type EventMoment,
} from './event';

setupRitewayBun();

const data = sampleEvent(NOW);
if (!data) throw new Error('no sample event');
const screen = (moment: EventMoment) => eventFlow(data, moment, NOW);
const ctas = (moment: EventMoment) =>
  screen(moment).hero.ctas.map((cta) =>
    cta.kind === 'link' ? `${cta.label} -> ${cta.href}` : cta.id,
  );

describe('parseEventMoment and eventHref', () => {
  test('junk falls back to the released pairing', () => {
    assert({
      given: 'nothing, a moment, an array and junk',
      should: 'parse the first valid moment, else released',
      actual: [
        parseEventMoment({}),
        parseEventMoment({ moment: 'won' }),
        parseEventMoment({ moment: ['live', 'won'] }),
        parseEventMoment({ moment: 'bogus' }),
      ],
      expected: ['released', 'won', 'live', 'released'],
    });
    assert({
      given: 'the released moment and another',
      should: 'leave the default off the URL',
      actual: [
        eventHref('harvest-cup', 'released'),
        eventHref('harvest-cup', 'live'),
      ],
      expected: [
        '/tournaments/mine/harvest-cup',
        '/tournaments/mine/harvest-cup?moment=live',
      ],
    });
  });
});

describe('eventFlow', () => {
  test('every moment has a headline and a round label', () => {
    assert({
      given: 'each moment',
      should: 'give the title and round label',
      actual: eventMoments.map((moment) => [
        screen(moment).hero.title,
        screen(moment).roundLabel,
      ]),
      expected: [
        [
          'You won the quarterfinal. Semifinal pairings come next.',
          'Quarterfinals complete',
        ],
        ['Your semifinal is set', 'Semifinal, starts 12:18'],
        ['Check in to enter your room', 'Semifinal, check-in open'],
        ['Your debate is in progress', 'Semifinal, in progress'],
        ['You won. You are in the final.', 'Semifinal complete'],
        [
          'You lost the semifinal. You finish equal third.',
          'Semifinal complete',
        ],
      ],
    });
  });

  test('released: countdown note, pairing, disabled check-in and report', () => {
    const { hero } = screen('released');
    assert({
      given: 'the released moment',
      should:
        'show the pairing with a start countdown and two disabled controls',
      actual: [
        hero.note,
        hero.showPairing,
        hero.ctas,
        hero.inert.map((item) => item.label),
      ],
      expected: [
        'Starts in 18 minutes',
        true,
        [],
        ['Check in (opens 12:08)', 'Report a conflict'],
      ],
    });
  });

  test('check-in opens the room by a plain link', () => {
    assert({
      given: 'the check-in moment',
      should: 'link Check in and open room to the pairing room',
      actual: [
        ctas('checkin'),
        screen('checkin').hero.status,
        screen('checkin').hero.note,
      ],
      expected: [
        [
          'Check in and open room -> /tournaments/mine/harvest-cup/room/semifinal-1',
        ],
        '@debater-c has checked in. @judge-k has joined the room.',
        'Check in by 12:28 or the round can be forfeited',
      ],
    });
  });

  test('live, won and lost', () => {
    assert({
      given: 'in debate, a win and a loss',
      should: 'offer the room, the bracket and recordings, or the next event',
      actual: [
        ctas('live'),
        ctas('won'),
        ctas('lost'),
        screen('live').hero.live,
        screen('won').hero.reason,
      ],
      expected: [
        ['Return to room -> /tournaments/mine/harvest-cup/room/semifinal-1'],
        [
          'See the bracket -> /tournaments/harvest-cup/bracket',
          'Watch the recording -> /recordings',
        ],
        [
          'Watch the final -> /tournaments/harvest-cup/bracket',
          'Watch your recording -> /recordings',
          'Find the next event -> /tournaments',
        ],
        true,
        true,
      ],
    });
  });

  test('the path marks won, now and lost', () => {
    const marks = (moment: EventMoment) =>
      screen(moment).path.map((step) => step.mark);
    assert({
      given: 'waiting, released, won and lost',
      should: 'mark the quarterfinal won and the current or finished semifinal',
      actual: [
        marks('waiting'),
        marks('released'),
        marks('won'),
        marks('lost'),
      ],
      expected: [
        ['W', '', ''],
        ['W', 'Now', ''],
        ['W', 'W', 'Now'],
        ['W', 'L', ''],
      ],
    });
  });

  test('played rounds gain the semifinal once it ends', () => {
    assert({
      given: 'released, won and lost',
      should: 'list one round, then two with the result',
      actual: [
        screen('released').rounds.length,
        screen('won').rounds.at(-1)?.result,
        screen('lost').rounds.at(-1)?.result,
      ],
      expected: [1, 'Won', 'Lost'],
    });
  });
});
