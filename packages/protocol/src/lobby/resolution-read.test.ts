import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  resolutionPoolViewSchema,
  resolutionReadCatalogue,
  resolutionViewSchema,
} from './resolution-read';

setupRitewayBun();

const id = (word: string) => word.padEnd(24, '0');
const final = { id: id('final'), number: 7, name: 'Final' };

const held = {
  id: id('held'),
  origin: {
    kind: 'lobby',
    addedBy: { name: 'Lena Cho', roleName: 'Topic committee' },
  },
  hold: { tabRoundName: 'Final', released: false },
  text: {
    kind: 'shown',
    text: 'Public transport should be free in every city.',
  },
};

const pool = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  counts: { fromPool: 18, addedHere: 2 },
  shortfall: null,
  resolutions: [
    {
      id: id('league'),
      origin: { kind: 'pool', poolName: "Southeast League's November pool" },
      hold: null,
      text: { kind: 'shown', text: 'Buses should be free for under-18s.' },
    },
    held,
  ],
  rules: [
    {
      tabRounds: [{ id: id('round1'), number: 1, name: null }],
      rule: {
        method: 'strike',
        drawSize: 5,
        strikeWindowMs: 60_000,
        firstStriker: 0,
      },
      changeable: true,
      releaseLeadMs: null,
    },
    {
      tabRounds: [final],
      rule: { method: 'fixed', release: 'manual' },
      changeable: true,
      releaseLeadMs: 900_000,
    },
  ],
  unreleased: [
    {
      tabRound: final,
      text: held.text,
      releasesAt: '2026-11-14T18:15:00.000Z',
      readerRoles: ['Topic committee'],
    },
  ],
  capabilities: { edit: true, release: true },
};

/** The same pool as a host without `tournament.resolutions.read_unreleased` reads it. */
const withheld = {
  ...pool,
  resolutions: [pool.resolutions[0], { ...held, text: { kind: 'withheld' } }],
  unreleased: [{ ...pool.unreleased[0], text: { kind: 'withheld' } }],
};

describe('ResolutionPoolView', async () => {
  test('unreleased text only with its permission', () => {
    assert({
      given: 'the pool with and without the permission to read unreleased text',
      should: 'parse both variants unchanged',
      actual: [
        parseOutcome(resolutionPoolViewSchema, pool),
        parseOutcome(resolutionPoolViewSchema, withheld),
      ],
      expected: [{ data: pool }, { data: withheld }],
    });
  });

  test('only unreleased text is withheld', () => {
    assert({
      given: 'a pool resolution with no hold carrying no text',
      should: 'refuse it',
      actual: parseOutcome(resolutionPoolViewSchema, {
        ...pool,
        resolutions: [{ ...pool.resolutions[0], text: { kind: 'withheld' } }],
      }),
      expected: { issues: ['resolutions.0.text'] },
    });
  });

  test('a rule is the setting value', () => {
    assert({
      given: 'a strike rule drawing one',
      should: 'refuse the draw size',
      actual: parseOutcome(resolutionPoolViewSchema, {
        ...pool,
        rules: [
          { ...pool.rules[0], rule: { ...pool.rules[0]?.rule, drawSize: 1 } },
        ],
      }),
      expected: { issues: ['rules.0.rule.drawSize'] },
    });
  });

  test('a strict shape', () => {
    assert({
      given: 'a pool carrying an unknown field',
      should: 'refuse it',
      actual: parseOutcome(resolutionPoolViewSchema, { ...pool, href: '/x' }),
      expected: { issues: ['(root)'] },
    });
  });
});

describe('ResolutionView', async () => {
  test('a variant for each moment a participant sees', () => {
    const views = [
      { tabRoundId: id('round'), resolution: { kind: 'not_released' } },
      {
        tabRoundId: id('round'),
        resolution: {
          kind: 'strike',
          candidates: [
            { id: id('one'), text: 'One.' },
            { id: id('two'), text: 'Two.' },
          ],
        },
      },
      {
        tabRoundId: id('round'),
        resolution: { kind: 'released', text: 'One.' },
      },
    ];
    assert({
      given: 'a resolution not released, struck from, and released',
      should: 'parse each unchanged',
      actual: views.map((view) => parseOutcome(resolutionViewSchema, view)),
      expected: views.map((data) => ({ data })),
    });
  });

  test('an unreleased resolution carries no text', () => {
    assert({
      given: 'a not-released resolution carrying its text',
      should: 'refuse the text',
      actual: parseOutcome(resolutionViewSchema, {
        tabRoundId: id('round'),
        resolution: { kind: 'not_released', text: 'One.' },
      }),
      expected: { issues: ['resolution'] },
    });
  });
});

describe('resolutionReadCatalogue', async () => {
  test('gates', () => {
    assert({
      given: 'the resolution reads',
      should: 'gate the pool on lobby.host.read and a round on resolution.read',
      actual: resolutionReadCatalogue,
      expected: {
        ResolutionPoolView: { gate: ['lobby.host.read'] },
        ResolutionView: { gate: ['resolution.read'] },
      },
    });
  });
});
