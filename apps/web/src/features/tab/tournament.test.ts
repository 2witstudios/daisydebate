import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linkTo, sampleAction } from './action';
import { landingStop, type RailItem, type TimelineRail } from './tournament';

setupRitewayBun();

const stop = (
  id: string,
  note: string | null,
  action: RailItem['action'],
): RailItem => ({ id, label: id, time: null, note, action });
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
            stop('setup', 'done', linkTo('Setup', '/setup')),
            stop('4', 'draft', linkTo('4', '/4')),
            stop('3', '2 need you', linkTo('3', '/3')),
          ]),
        ),
        landingStop(
          rail([
            stop('setup', 'done', linkTo('Setup', '/setup')),
            stop('4', 'draft', linkTo('4', '/4')),
          ]),
        ),
        landingStop(
          rail([
            stop('entries', 'need you', sampleAction('Entries')),
            stop('setup', 'done', linkTo('Setup', '/setup')),
          ]),
        ),
        landingStop(rail([stop('results', null, null)])),
      ],
      expected: ['/3', '/4', '/setup', null],
    });
  });
});
