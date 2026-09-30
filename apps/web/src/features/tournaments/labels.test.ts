import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  bandLabel,
  fillPercent,
  metaLabel,
  mineLabel,
  rowAction,
  rulesLabel,
  slotsLabel,
  statusLabel,
  structureLabel,
  whenLabel,
} from './labels';
import { tournament } from './tournament.test-support';

setupRitewayBun();

const registered = {
  kind: 'registered',
  note: '',
  firstOpponent: null,
} as const;

describe('labels', () => {
  test('names', () => {
    assert({
      given: 'each structure, rules kind and status',
      should: 'use the list wording',
      actual: [
        structureLabel('round-robin'),
        rulesLabel('custom'),
        statusLabel('full'),
        statusLabel('not-open'),
        slotsLabel(tournament()),
        fillPercent(tournament({ entered: 8, places: 32 })),
        bandLabel({ min: 1300, max: 1700 }),
        bandLabel({ min: 1300, max: null }),
        bandLabel({ min: null, max: 1400 }),
        bandLabel({ min: null, max: null }),
      ],
      expected: [
        'Round robin',
        'Custom rules',
        'Full, waitlist',
        'Not open yet',
        '8 of 16',
        25,
        '1300 to 1700',
        '1300 and above',
        'up to 1400',
        'any rating',
      ],
    });
  });

  test('the when and meta lines follow the status', () => {
    const live = tournament({
      lifecycle: 'in-progress',
      progress: { when: 'Semifinals today, 14:00', note: 'Round 3 begins' },
    });
    const done = tournament({
      lifecycle: 'completed',
      outcome: { label: 'Champion', handle: 'debater-c' },
    });
    assert({
      given: 'open, announced, full, closed, live and done tournaments',
      should: 'say when and what is next',
      actual: [
        whenLabel(tournament()),
        whenLabel(live),
        whenLabel(done),
        metaLabel(tournament()),
        metaLabel(tournament({ lifecycle: 'announced' })),
        metaLabel(tournament({ entered: 16, waitlisted: 3 })),
        metaLabel(tournament({ lifecycle: 'registration-closed' })),
        metaLabel(live),
        metaLabel(done),
      ],
      expected: [
        'Sat 10 Oct, 14:00 UTC',
        'Semifinals today, 14:00',
        'Sat 10 Oct',
        'Registration closes Thu 8 Oct',
        'Registration opens Sun 20 Sep',
        'Full, 3 on the waitlist',
        'Registration closed 8 Oct',
        'Round 3 begins',
        'Champion: @debater-c',
      ],
    });
  });

  test('the viewer line', () => {
    assert({
      given: 'no entry, each entry kind',
      should: 'say nothing, or the viewer status',
      actual: [
        mineLabel(null),
        mineLabel(registered),
        mineLabel({ kind: 'waitlisted', position: 2, note: '' }),
        mineLabel({ kind: 'competing', stage: 'semifinal', note: '' }),
      ],
      expected: [
        null,
        'You are registered',
        'You are waitlisted, position 2',
        'You are in: semifinal',
      ],
    });
  });
});

describe('rowAction', () => {
  test('each status offers one action', () => {
    const action = (
      over: Parameters<typeof tournament>[0],
      entry = null as typeof registered | null,
    ) => {
      const result = rowAction(tournament({ id: 'x', ...over }), entry);
      return result.kind === 'link'
        ? [result.label, result.href, result.primary]
        : [result.label, result.kind];
    };
    assert({
      given: 'each status, with and without an entry',
      should: 'point at the guarded flow, the event, or the public pages',
      actual: [
        action({}),
        action({}, registered),
        action({ entered: 16 }),
        action({ lifecycle: 'announced' }),
        action({ lifecycle: 'registration-closed' }),
        action({ lifecycle: 'in-progress' }),
        action({ lifecycle: 'completed' }),
      ],
      expected: [
        ['Register', '/tournaments/enter/x', true],
        ['View', '/tournaments/x', false],
        ['Join waitlist', '/tournaments/enter/x', true],
        ['Remind me', 'inert'],
        ['View', '/tournaments/x', false],
        ['Follow', '/tournaments/x/bracket', false],
        ['Results', '/tournaments/x/results', false],
      ],
    });
  });

  test('a competitor opens their event', () => {
    const result = rowAction(
      tournament({ id: 'x', lifecycle: 'in-progress' }),
      { kind: 'competing', stage: 'semifinal', note: '' },
    );
    assert({
      given: 'a live tournament the viewer is in',
      should: 'open my event as the primary action',
      actual: result,
      expected: {
        kind: 'link',
        label: 'Open my event',
        href: '/tournaments/mine/x',
        primary: true,
      },
    });
  });
});
