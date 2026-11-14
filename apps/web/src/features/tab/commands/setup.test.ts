import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  decideSetup,
  slotClashes,
  type SetupEventFact,
  type SetupFacts,
  type StageFact,
  type TabRoundFact,
} from './setup';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, 'z');
const now = '2026-12-01T09:00:00.000Z';
const lobbyId = id('lobby');

const ld: SetupEventFact = {
  id: id('ld'),
  name: 'Varsity LD',
  label: 'VLD',
  formatId: 'value',
  formatVersion: 1,
  ballotDefinitionId: null,
  ballotDefinitionVersion: null,
  templateId: null,
  version: 1,
  entryCount: 0,
  sanctionCount: 0,
  divisions: ['novice', 'open'],
  resolutionMethod: 'fixed',
  doubleQualifier: 'both',
  entrantUserIds: [id('ada'), id('ben')],
};
const pf: SetupEventFact = {
  ...ld,
  id: id('pf'),
  name: 'Public Forum',
  label: 'PF',
  templateId: id('tmpl'),
  resolutionMethod: 'draw',
  entrantUserIds: [id('ben'), id('cy')],
};
const stage = (
  name: string,
  overrides: Partial<StageFact> = {},
): StageFact => ({
  id: id(name),
  eventId: ld.id,
  kind: 'preliminary',
  sequence: 1,
  timing: 'live',
  version: 1,
  ...overrides,
});
const round = (
  name: string,
  overrides: Partial<TabRoundFact> = {},
): TabRoundFact => ({
  id: id(name),
  eventId: ld.id,
  stageId: id('prelims'),
  number: 1,
  timeSlotId: null,
  poolResolutionId: null,
  version: 1,
  drawPublished: false,
  ...overrides,
});

const base: SetupFacts = {
  now,
  newIds: { primary: id('new'), secondary: id('newpool') },
  lobby: { id: lobbyId, kind: 'tournament', closedAt: null, version: 5 },
  events: [ld, pf],
  stages: [
    stage('prelims'),
    stage('window', { sequence: 2, timing: 'windowed' }),
    stage('novbreak', { kind: 'elimination', sequence: 3 }),
    stage('openbreak', { kind: 'elimination', sequence: 4 }),
    stage('pfprelims', { eventId: pf.id }),
  ],
  tabRounds: [
    round('r1', {
      timeSlotId: id('sat9'),
      drawPublished: true,
      poolResolutionId: id('motion'),
    }),
    round('r2', { number: 2 }),
    round('w1', { stageId: id('window') }),
    round('novqf', { stageId: id('novbreak'), timeSlotId: id('sun9') }),
    round('openqf', { stageId: id('openbreak') }),
    round('pf1', {
      eventId: pf.id,
      stageId: id('pfprelims'),
      timeSlotId: id('sat11'),
    }),
  ],
  timeSlots: [
    {
      id: id('sat9'),
      name: 'Saturday 9am',
      startsAt: '2026-12-05T09:00:00Z',
      version: 3,
    },
    {
      id: id('sat11'),
      name: 'Saturday 11am',
      startsAt: '2026-12-05T11:00:00Z',
      version: 1,
    },
    {
      id: id('sun9'),
      name: 'Sunday 9am',
      startsAt: '2026-12-06T09:00:00Z',
      version: 2,
    },
    {
      id: id('sun11'),
      name: 'Sunday 11am',
      startsAt: '2026-12-06T11:00:00Z',
      version: 1,
    },
  ],
  formats: [{ formatId: 'value', formatVersion: 1 }],
  ballotDefinitions: [{ id: id('ballot'), lobbyId, currentVersion: 2 }],
  templates: [
    {
      id: id('tmpl'),
      formatId: 'policy',
      formatVersion: 3,
      ballotDefinitionId: id('ballot'),
      ballotDefinitionVersion: 1,
      retiredAt: null,
      conflictsWithChain: false,
    },
  ],
  resolutionPools: [
    {
      id: id('pool'),
      lobbyId,
      resolutions: [
        { id: id('motion'), retiredAt: null },
        { id: id('spare'), retiredAt: null },
        { id: id('old'), retiredAt: now },
      ],
    },
  ],
};
const facts = (overrides: Partial<SetupFacts> = {}): SetupFacts => ({
  ...base,
  ...overrides,
});

const bump = {
  table: 'lobbies',
  op: 'update',
  id: lobbyId,
  set: { version: 6 },
};
const decided = (given: SetupFacts, command: TournamentSetupCommand) => {
  const decision = decideSetup(given, command);
  return decision.kind === 'refused' ? decision.refusal : decision.writes;
};
const refusals = (
  cases: readonly (readonly [SetupFacts, TournamentSetupCommand])[],
) => cases.map(([given, command]) => decided(given, command));

type Of<Type extends TournamentSetupCommand['type']> = Extract<
  TournamentSetupCommand,
  { type: Type }
>;

describe('every setup command', () => {
  const command: Of<'add-time-slot'> = {
    type: 'add-time-slot',
    lobbyId,
    name: 'Sunday 1pm',
    startsAt: '2026-12-06T13:00:00Z',
  };
  test('runs on an open tournament lobby and moves its version', () => {
    const decision = decideSetup(facts(), command);
    assert({
      given: 'an accepted setup command',
      should: 'answer the lobby at its next version',
      actual: decision.kind === 'accepted' && [
        decision.aggregate,
        decision.resultingVersion,
      ],
      expected: [{ kind: 'lobby', id: lobbyId }, 6],
    });
    assert({
      given: 'no lobby, a closed lobby and a standing lobby',
      should: 'refuse each by name',
      actual: refusals([
        [facts({ lobby: null }), command],
        [
          facts({
            lobby: {
              id: lobbyId,
              kind: 'tournament',
              closedAt: now,
              version: 5,
            },
          }),
          command,
        ],
        [
          facts({
            lobby: {
              id: lobbyId,
              kind: 'standing',
              closedAt: null,
              version: 5,
            },
          }),
          command,
        ],
      ]),
      expected: ['not-found', 'lobby-closed', 'lobby-not-tournament'],
    });
  });
});

describe('events', () => {
  const add: Of<'add-event'> = {
    type: 'add-event',
    lobbyId,
    name: 'Novice LD',
    label: 'NLD',
    entry: { kind: 'team', size: 2 },
    pin: {
      kind: 'format',
      formatId: 'value',
      formatVersion: 1,
      ballotDefinition: { id: id('ballot'), version: 2 },
    },
  };
  const follow: Of<'add-event'> = {
    ...add,
    pin: { kind: 'template', templateId: id('tmpl') },
  };
  const [template] = base.templates;
  test('adds an event pinning a format, or following a template', () => {
    const row = {
      id: id('new'),
      lobbyId,
      name: 'Novice LD',
      label: 'NLD',
      entryKind: 'team',
      teamSize: 2,
    };
    assert({
      given: 'a format pin, and a template to follow',
      should:
        "pin the format, or take the template's format and ballot definition with its link",
      actual: [decided(facts(), add), decided(facts(), follow)],
      expected: [
        [
          {
            table: 'events',
            op: 'insert',
            row: {
              ...row,
              formatId: 'value',
              formatVersion: 1,
              ballotDefinitionId: id('ballot'),
              ballotDefinitionVersion: 2,
              templateId: null,
            },
          },
          bump,
        ],
        [
          {
            table: 'events',
            op: 'insert',
            row: {
              ...row,
              formatId: 'policy',
              formatVersion: 3,
              ballotDefinitionId: id('ballot'),
              ballotDefinitionVersion: 1,
              templateId: id('tmpl'),
            },
          },
          bump,
        ],
      ],
    });
  });
  test('names each add-event refusal', () => {
    assert({
      given:
        'a taken name, an unknown format, an unknown ballot version, a retired, missing and conflicting template',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...add, name: 'varsity ld' }],
        [
          facts(),
          { ...add, pin: { ...add.pin, formatVersion: 9 } } as Of<'add-event'>,
        ],
        [
          facts(),
          {
            ...add,
            pin: {
              kind: 'format',
              formatId: 'value',
              formatVersion: 1,
              ballotDefinition: { id: id('ballot'), version: 3 },
            },
          },
        ],
        [facts({ templates: [{ ...template!, retiredAt: now }] }), follow],
        [facts({ templates: [] }), follow],
        [
          facts({ templates: [{ ...template!, conflictsWithChain: true }] }),
          follow,
        ],
      ]),
      expected: [
        'name-taken',
        'format-unavailable',
        'not-found',
        'template-unavailable',
        'template-unavailable',
        'enforced-conflict',
      ],
    });
  });

  const update: Of<'update-event'> = {
    type: 'update-event',
    lobbyId,
    eventId: ld.id,
    name: 'Varsity Lincoln-Douglas',
    label: null,
    ballotDefinition: { id: id('ballot'), version: 1 },
  };
  test('updates an event', () => {
    assert({
      given: 'a new name, label and ballot definition version',
      should: 'write them and move the event version',
      actual: decided(facts(), update),
      expected: [
        {
          table: 'events',
          op: 'update',
          id: ld.id,
          set: {
            name: 'Varsity Lincoln-Douglas',
            label: null,
            ballotDefinitionId: id('ballot'),
            ballotDefinitionVersion: 1,
            version: 2,
          },
        },
        bump,
      ],
    });
  });
  test('names each update-event refusal', () => {
    assert({
      given:
        'a following event, entries in, a missing ballot version, another event name and no event',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...update, eventId: pf.id, name: 'Public Forum' }],
        [facts({ events: [{ ...ld, entryCount: 3 }, pf] }), update],
        [
          facts(),
          { ...update, ballotDefinition: { id: id('ballot'), version: 7 } },
        ],
        [facts(), { ...update, name: 'PUBLIC FORUM' }],
        [facts(), { ...update, eventId: id('gone') }],
      ]),
      expected: [
        'template-pinned',
        'entries-exist',
        'not-found',
        'name-taken',
        'not-found',
      ],
    });
    assert({
      given: 'a following event renamed with its pinned ballot unchanged',
      should: 'accept it',
      actual: Array.isArray(
        decided(facts(), {
          ...update,
          eventId: pf.id,
          name: 'PF',
          ballotDefinition: null,
        }),
      ),
      expected: true,
    });
  });

  const remove: Of<'remove-event'> = {
    type: 'remove-event',
    lobbyId,
    eventId: pf.id,
  };
  test('removes an event with its stages and tab rounds', () => {
    assert({
      given: 'an event with no entries',
      should: 'delete its tab rounds, its stages and itself',
      actual: decided(facts(), remove),
      expected: [
        { table: 'tab_rounds', op: 'delete', id: id('pf1') },
        { table: 'stages', op: 'delete', id: id('pfprelims') },
        { table: 'events', op: 'delete', id: pf.id },
        bump,
      ],
    });
    assert({
      given: 'entries in, a sanction, and no event',
      should: 'refuse each by name',
      actual: refusals([
        [facts({ events: [ld, { ...pf, entryCount: 1 }] }), remove],
        [facts({ events: [ld, { ...pf, sanctionCount: 1 }] }), remove],
        [facts(), { ...remove, eventId: id('gone') }],
      ]),
      expected: ['entries-exist', 'event-sanctioned', 'not-found'],
    });
  });
});

describe('stages', () => {
  const add: Of<'add-stage'> = {
    type: 'add-stage',
    lobbyId,
    eventId: ld.id,
    kind: 'elimination',
    place: 'in_person',
    timing: {
      timing: 'windowed',
      opensAt: '2026-12-05T09:00:00Z',
      closesAt: '2026-12-05T17:00:00Z',
    },
    division: 'novice',
  };
  test('adds a stage after the event stages', () => {
    assert({
      given: 'a windowed elimination stage for a known division',
      should: 'insert it next in sequence with its window',
      actual: decided(facts(), add),
      expected: [
        {
          table: 'stages',
          op: 'insert',
          row: {
            id: id('new'),
            lobbyId,
            eventId: ld.id,
            kind: 'elimination',
            sequence: 5,
            division: 'novice',
            place: 'in_person',
            timing: 'windowed',
            windowOpensAt: '2026-12-05T09:00:00Z',
            windowClosesAt: '2026-12-05T17:00:00Z',
          },
        },
        bump,
      ],
    });
    assert({
      given: 'an unknown division and an unknown event',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...add, division: 'junior' }],
        [facts(), { ...add, eventId: id('gone') }],
      ]),
      expected: ['division-unknown', 'not-found'],
    });
  });

  const update: Of<'update-stage'> = {
    type: 'update-stage',
    lobbyId,
    stageId: id('novbreak'),
    place: 'online',
    timing: { timing: 'live' },
    division: 'open',
  };
  test('updates a stage until it starts', () => {
    assert({
      given: 'an unstarted elimination stage moved online for a division',
      should: 'write it and move its version',
      actual: decided(facts(), update),
      expected: [
        {
          table: 'stages',
          op: 'update',
          id: id('novbreak'),
          set: {
            division: 'open',
            place: 'online',
            timing: 'live',
            windowOpensAt: null,
            windowClosesAt: null,
            version: 2,
          },
        },
        bump,
      ],
    });
    const windowed = {
      timing: 'windowed',
      opensAt: '2026-12-05T09:00:00Z',
      closesAt: '2026-12-05T17:00:00Z',
    } as const;
    assert({
      given:
        'a started stage, a preliminary or unknown division, a placed stage made windowed, and no stage',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...update, stageId: id('prelims'), division: null }],
        [facts(), { ...update, stageId: id('window'), division: 'open' }],
        [facts(), { ...update, division: 'junior' }],
        [facts(), { ...update, timing: windowed }],
        [facts(), { ...update, stageId: id('gone') }],
      ]),
      expected: [
        'stage-started',
        'division-unknown',
        'division-unknown',
        'rounds-placed',
        'not-found',
      ],
    });
  });
});

describe('tab rounds', () => {
  const add: Of<'add-tab-round'> = {
    type: 'add-tab-round',
    lobbyId,
    stageId: id('prelims'),
    name: 'Round 3',
    resolution: { poolId: id('pool'), poolResolutionId: id('spare') },
  };
  test('adds a numbered tab round with its pool and fixed wording', () => {
    assert({
      given: 'a fixed-rule event and a live wording from its pool',
      should: 'insert the next number, unplaced',
      actual: decided(facts(), add),
      expected: [
        {
          table: 'tab_rounds',
          op: 'insert',
          row: {
            id: id('new'),
            lobbyId,
            eventId: ld.id,
            stageId: id('prelims'),
            number: 3,
            name: 'Round 3',
            timeSlotId: null,
            resolutionPoolId: id('pool'),
            poolResolutionId: id('spare'),
          },
        },
        bump,
      ],
    });
    assert({
      given:
        'a wording where the rule is not fixed, a retired wording, an unknown pool, wording and stage',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...add, stageId: id('pfprelims') }],
        [
          facts(),
          {
            ...add,
            resolution: { poolId: id('pool'), poolResolutionId: id('old') },
          },
        ],
        [
          facts(),
          {
            ...add,
            resolution: { poolId: id('nopool'), poolResolutionId: null },
          },
        ],
        [
          facts(),
          {
            ...add,
            resolution: { poolId: id('pool'), poolResolutionId: id('nothing') },
          },
        ],
        [facts(), { ...add, stageId: id('gone') }],
      ]),
      expected: [
        'resolution-not-fixed',
        'resolution-retired',
        'not-found',
        'not-found',
        'not-found',
      ],
    });
    assert({
      given: 'a pool with no fixed wording on a drawn-rule event',
      should: 'accept it',
      actual: Array.isArray(
        decided(facts(), {
          ...add,
          stageId: id('pfprelims'),
          resolution: { poolId: id('pool'), poolResolutionId: null },
        }),
      ),
      expected: true,
    });
  });

  const update: Of<'update-tab-round'> = {
    type: 'update-tab-round',
    lobbyId,
    tabRoundId: id('r2'),
    name: null,
    resolution: null,
  };
  test('updates a tab round until its draw is published', () => {
    assert({
      given: 'an unpublished tab round cleared of its name and pool',
      should: 'write them and move its version',
      actual: decided(facts(), update),
      expected: [
        {
          table: 'tab_rounds',
          op: 'update',
          id: id('r2'),
          set: {
            name: null,
            resolutionPoolId: null,
            poolResolutionId: null,
            version: 2,
          },
        },
        bump,
      ],
    });
    assert({
      given:
        'a published draw, a wording where the rule is not fixed and no tab round',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), { ...update, tabRoundId: id('r1') }],
        [
          facts(),
          {
            ...update,
            tabRoundId: id('pf1'),
            resolution: { poolId: id('pool'), poolResolutionId: id('spare') },
          },
        ],
        [facts(), { ...update, tabRoundId: id('gone') }],
      ]),
      expected: ['draw-published', 'resolution-not-fixed', 'not-found'],
    });
  });
});

describe('time slots', () => {
  const update: Of<'update-time-slot'> = {
    type: 'update-time-slot',
    lobbyId,
    timeSlotId: id('sat9'),
    name: 'Saturday morning',
    startsAt: '2026-12-05T09:00:00.000Z',
  };
  const remove: Of<'remove-time-slot'> = {
    type: 'remove-time-slot',
    lobbyId,
    timeSlotId: id('sun9'),
  };
  test('adds, renames and removes slots', () => {
    assert({
      given:
        'a new slot, a slot in use renamed at the same time, and an unused slot removed',
      should: 'insert, update, and unplace its tab rounds before deleting it',
      actual: [
        decided(facts(), {
          type: 'add-time-slot',
          lobbyId,
          name: 'Sunday 1pm',
          startsAt: '2026-12-06T13:00:00Z',
        }),
        decided(facts(), update),
        decided(facts(), remove),
      ],
      expected: [
        [
          {
            table: 'time_slots',
            op: 'insert',
            row: {
              id: id('new'),
              lobbyId,
              name: 'Sunday 1pm',
              startsAt: '2026-12-06T13:00:00Z',
            },
          },
          bump,
        ],
        [
          {
            table: 'time_slots',
            op: 'update',
            id: id('sat9'),
            set: {
              name: 'Saturday morning',
              startsAt: '2026-12-05T09:00:00.000Z',
              version: 4,
            },
          },
          bump,
        ],
        [
          {
            table: 'tab_rounds',
            op: 'update',
            id: id('novqf'),
            set: { timeSlotId: null, version: 2 },
          },
          { table: 'time_slots', op: 'delete', id: id('sun9') },
          bump,
        ],
      ],
    });
  });
  test('names each refusal', () => {
    assert({
      given: 'a taken name, a slot in use moved or removed, and no slot',
      should: 'refuse each by name',
      actual: refusals([
        [
          facts(),
          {
            type: 'add-time-slot',
            lobbyId,
            name: 'saturday 9AM',
            startsAt: now,
          },
        ],
        [facts(), { ...update, name: 'Sunday 9am' }],
        [facts(), { ...update, startsAt: '2026-12-05T10:00:00Z' }],
        [facts(), { ...remove, timeSlotId: id('sat9') }],
        [facts(), { ...remove, timeSlotId: id('gone') }],
      ]),
      expected: [
        'name-taken',
        'name-taken',
        'slot-in-use',
        'slot-in-use',
        'not-found',
      ],
    });
  });
});

describe('place-tab-round', () => {
  const place = (
    tabRound: string,
    slot: string | null,
  ): Of<'place-tab-round'> => ({
    type: 'place-tab-round',
    lobbyId,
    tabRoundId: id(tabRound),
    timeSlotId: slot === null ? null : id(slot),
  });
  test('puts a tab round in a slot, or takes it out, moving each slot version', () => {
    assert({
      given: 'a round placed in a free slot, and a placed round taken out',
      should: 'write the placement and move the slot it entered or left',
      actual: [
        decided(facts(), place('r2', 'sun11')),
        decided(facts(), place('novqf', null)),
      ],
      expected: [
        [
          {
            table: 'tab_rounds',
            op: 'update',
            id: id('r2'),
            set: { timeSlotId: id('sun11'), version: 2 },
          },
          {
            table: 'time_slots',
            op: 'update',
            id: id('sun11'),
            set: { version: 2 },
          },
          bump,
        ],
        [
          {
            table: 'tab_rounds',
            op: 'update',
            id: id('novqf'),
            set: { timeSlotId: null, version: 2 },
          },
          {
            table: 'time_slots',
            op: 'update',
            id: id('sun9'),
            set: { version: 3 },
          },
          bump,
        ],
      ],
    });
  });
  test('names each refusal', () => {
    const higher = facts({
      events: [{ ...ld, doubleQualifier: 'higher' }, pf],
    });
    assert({
      given:
        'a published draw, the same slot, a windowed stage, a person in two events, two breaks with double qualifiers taking both, and unknown rows',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), place('r1', 'sun11')],
        [facts(), place('r2', null)],
        [facts(), place('w1', 'sun11')],
        [facts(), place('r2', 'sat11')],
        [facts(), place('openqf', 'sun9')],
        [facts(), place('gone', 'sun9')],
        [facts(), place('r2', 'gone')],
      ]),
      expected: [
        'draw-published',
        'placement-unchanged',
        'stage-windowed',
        'slot-clash',
        'breaks-share-slot',
        'not-found',
        'not-found',
      ],
    });
    const clash = decideSetup(facts(), place('r2', 'sat11'));
    assert({
      given: 'a placement that would put a person in two events at once',
      should: 'name the people in the refusal',
      actual:
        clash.kind === 'refused' ? (clash.people ?? []).length > 0 : false,
      expected: true,
    });
    assert({
      given:
        'two breaks sharing a slot where double qualifiers take the higher',
      should: 'accept the placement',
      actual: Array.isArray(decided(higher, place('openqf', 'sun9'))),
      expected: true,
    });
  });
  test('names the people a clash would double-book', () => {
    assert({
      given: 'a Varsity LD round placed beside Public Forum',
      should: 'name the one person entered in both',
      actual: slotClashes(facts(), round('r2', { number: 2 }), id('sat11')),
      expected: [id('ben')],
    });
  });
});

describe('define-ballot', () => {
  const settings = {
    points: { min: 20, max: 30, step: 1, lowPointWin: false },
    ranks: false,
    criteria: [],
    outcomes: { winner: true, doubleLoss: false },
    written: { reason: 'required', feedback: 'optional', privateNote: 'off' },
  } as const;
  const define = (
    ballotDefinition: Of<'define-ballot'>['ballotDefinition'],
  ): Of<'define-ballot'> => ({
    type: 'define-ballot',
    lobbyId,
    ballotDefinition,
    settings,
  });
  test('always writes a new ballot definition version', () => {
    assert({
      given: 'a new definition, and a revision of the lobby definition',
      should:
        'write version 1 with its pointer, or the next version and move the pointer',
      actual: [
        decided(facts(), define({ kind: 'new', name: 'Open ballot' })),
        decided(
          facts(),
          define({ kind: 'revision', ballotDefinitionId: id('ballot') }),
        ),
      ],
      expected: [
        [
          {
            table: 'ballot_definitions',
            op: 'insert',
            row: {
              id: id('new'),
              lobbyId,
              name: 'Open ballot',
              currentVersion: 1,
            },
          },
          {
            table: 'ballot_definition_versions',
            op: 'insert',
            row: {
              ballotDefinitionId: id('new'),
              version: 1,
              lobbyId,
              definition: settings,
            },
          },
          bump,
        ],
        [
          {
            table: 'ballot_definition_versions',
            op: 'insert',
            row: {
              ballotDefinitionId: id('ballot'),
              version: 3,
              lobbyId,
              definition: settings,
            },
          },
          {
            table: 'ballot_definitions',
            op: 'update',
            id: id('ballot'),
            set: { currentVersion: 3 },
          },
          bump,
        ],
      ],
    });
    assert({
      given: 'a revision of a definition this lobby does not own',
      should: 'refuse it as not found',
      actual: decided(
        facts({
          ballotDefinitions: [
            { id: id('ballot'), lobbyId: null, currentVersion: 2 },
          ],
        }),
        define({ kind: 'revision', ballotDefinitionId: id('ballot') }),
      ),
      expected: 'not-found',
    });
  });
});

describe('resolutions', () => {
  const add: Of<'add-resolution'> = {
    type: 'add-resolution',
    lobbyId,
    pool: { kind: 'new', name: 'Elimination topics' },
    text: 'This house regrets social media.',
  };
  test('adds a resolution to a new or existing pool', () => {
    assert({
      given: 'a resolution in a new pool, and one in the lobby pool',
      should: 'insert the pool then the resolution, or the resolution alone',
      actual: [
        decided(facts(), add),
        decided(facts(), {
          ...add,
          pool: { kind: 'existing', poolId: id('pool') },
        }),
      ],
      expected: [
        [
          {
            table: 'resolution_pools',
            op: 'insert',
            row: { id: id('newpool'), lobbyId, name: 'Elimination topics' },
          },
          {
            table: 'pool_resolutions',
            op: 'insert',
            row: {
              id: id('new'),
              poolId: id('newpool'),
              lobbyId,
              text: 'This house regrets social media.',
            },
          },
          bump,
        ],
        [
          {
            table: 'pool_resolutions',
            op: 'insert',
            row: {
              id: id('new'),
              poolId: id('pool'),
              lobbyId,
              text: 'This house regrets social media.',
            },
          },
          bump,
        ],
      ],
    });
    assert({
      given: 'a pool this lobby does not own',
      should: 'refuse it as not found',
      actual: decided(facts(), {
        ...add,
        pool: { kind: 'existing', poolId: id('nopool') },
      }),
      expected: 'not-found',
    });
  });

  const retire = (resolution: string): Of<'retire-resolution'> => ({
    type: 'retire-resolution',
    lobbyId,
    poolResolutionId: id(resolution),
  });
  test('retires a resolution no tab round holds', () => {
    assert({
      given: 'an unused resolution',
      should: 'set it retired now',
      actual: decided(facts(), retire('spare')),
      expected: [
        {
          table: 'pool_resolutions',
          op: 'update',
          id: id('spare'),
          set: { retiredAt: now },
        },
        bump,
      ],
    });
    assert({
      given: 'a resolution a tab round holds, a retired one and none',
      should: 'refuse each by name',
      actual: refusals([
        [facts(), retire('motion')],
        [facts(), retire('old')],
        [facts(), retire('gone')],
      ]),
      expected: ['resolution-in-use', 'resolution-retired', 'not-found'],
    });
  });
});
