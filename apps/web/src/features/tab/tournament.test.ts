import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linkTo, sampleAction } from './action';
import { landingStop, type RailItem, type TimelineRail } from './tournament';

setupRitewayBun();

const stop = (
  id: string,
  standing: RailItem['standing'],
  action: RailItem['action'],
): RailItem => ({ id, label: id, time: null, standing, action });
const done = { kind: 'done' } as const;
const draft = { kind: 'draft' } as const;
const needsYou = { kind: 'needs_you', count: 2 } as const;
const rail = (items: readonly RailItem[]): TimelineRail => ({
  title: 'T',
  subtitle: null,
  heading: null,
  items,
  footHeading: null,
  foot: [],
});

describe('landingStop', () => {
  test('where a host lands', () => {
    assert({
      given:
        'a rail with a stop that needs the host, one with only a draft, one with nothing urgent and one with nothing to open',
      should: 'pick what most wants them, else the first stop that opens',
      actual: [
        landingStop(
          rail([
            stop('setup', done, linkTo('Setup', '/setup')),
            stop('4', draft, linkTo('4', '/4')),
            stop('3', needsYou, linkTo('3', '/3')),
          ]),
        ),
        landingStop(
          rail([
            stop('setup', done, linkTo('Setup', '/setup')),
            stop('4', draft, linkTo('4', '/4')),
          ]),
        ),
        landingStop(
          rail([
            stop('entries', needsYou, sampleAction('Entries')),
            stop('setup', done, linkTo('Setup', '/setup')),
          ]),
        ),
        landingStop(rail([stop('results', null, null)])),
      ],
      expected: ['/3', '/4', '/setup', null],
    });
  });

  test('a finished tournament', () => {
    assert({
      given: 'a rail with nothing urgent whose last stop is over',
      should: 'land on the last stop, its results, not back on setup',
      actual: landingStop(
        rail([
          stop('setup', done, linkTo('Setup', '/setup')),
          stop('entries', { kind: 'note', text: '48' }, linkTo('E', '/e')),
          stop(
            'results',
            { kind: 'done', as: 'certified' },
            linkTo('Results', '/results'),
          ),
        ]),
      ),
      expected: '/results',
    });
  });

  test('a stop whose words only sound urgent', () => {
    assert({
      given:
        'a stop whose note says "delivered" and "ready by 10:00", ahead of a draft',
      should: 'land on the draft: routing never reads the words on the rail',
      actual: landingStop(
        rail([
          stop(
            'posted',
            { kind: 'note', text: 'delivered, ready by 10:00' },
            linkTo('Posted', '/posted'),
          ),
          stop('4', draft, linkTo('4', '/4')),
        ]),
      ),
      expected: '/4',
    });
  });
});
