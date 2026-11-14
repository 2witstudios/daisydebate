import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import {
  isTournamentCancellable,
  isTournamentStatusForward,
  lobbySetupCommandCatalogue,
  lobbySetupCommandEnvelopeSchema,
  lobbySetupCommandSchema,
  lobbySetupRefusals,
  tournamentStatusMoves,
} from './lobby-setup-command';
import { sharedLobbyRefusals } from './command';
import { tournamentStatuses } from './vocabulary';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const lobbyId = id('l');
const at = (day: number) => `2026-12-${String(day).padStart(2, '0')}T09:00:00Z`;

const room = {
  commandId: id('c'),
  title: 'Friday practice',
  resolution: { kind: 'custom', text: 'This house would ban homework.' },
  visibility: 'public',
  selection: {
    kind: 'catalog',
    formatId: 'value',
    formatVersion: 1,
    presetVersion: 1,
    competitionType: 'casual',
  },
};

const ballotSettings = {
  points: { min: 20, max: 30, step: 0.5, lowPointWin: false },
  ranks: true,
  criteria: ['Argument', 'Delivery'],
  outcomes: { winner: true, doubleLoss: false },
  written: { reason: 'required', feedback: 'optional', privateNote: 'off' },
};

/** One accepted example per command and per variant of its payload. */
const valid = {
  'create-lobby': [
    {
      type: 'create-lobby',
      owner: { kind: 'organization', organizationId: id('o') },
      name: 'Valley League',
      handle: 'valley-league',
      lobby: { kind: 'standing' },
    },
    {
      type: 'create-lobby',
      owner: { kind: 'self' },
      name: 'Spring Open',
      handle: 'spring-open-2027',
      lobby: { kind: 'tournament', admitsMinors: true },
    },
  ],
  'update-lobby': [
    { type: 'update-lobby', lobbyId, name: 'Spring Open', admitsMinors: false },
    {
      type: 'update-lobby',
      lobbyId,
      name: 'Valley League',
      admitsMinors: null,
    },
  ],
  'set-tournament-status': tournamentStatusMoves.map((status) => ({
    type: 'set-tournament-status',
    lobbyId,
    status,
  })),
  'close-lobby': [{ type: 'close-lobby', lobbyId, reason: 'Venue lost.' }],
  'create-season': [
    {
      type: 'create-season',
      organizationId: id('o'),
      name: '2027 season',
      startsAt: at(1),
      endsAt: at(20),
      counting: 'sanction',
      countsLobbyRooms: false,
      rule: { best: 5 },
    },
    {
      type: 'create-season',
      organizationId: id('o'),
      name: 'Open season',
      startsAt: at(1),
      endsAt: null,
      counting: 'membership',
      countsLobbyRooms: true,
      rule: {},
    },
  ],
  'close-season': [{ type: 'close-season', seasonId: id('s') }],
  'set-ladder': [
    {
      type: 'set-ladder',
      organizationId: id('o'),
      lobbyId,
      ladder: { enabled: true, name: 'League ladder' },
    },
    {
      type: 'set-ladder',
      organizationId: id('o'),
      lobbyId,
      ladder: { enabled: false },
    },
  ],
  'create-lobby-room': [
    { type: 'create-lobby-room', lobbyId, templateId: id('t'), room },
    { type: 'create-lobby-room', lobbyId, templateId: null, room },
  ],
  'add-event': [
    {
      type: 'add-event',
      lobbyId,
      name: 'Varsity LD',
      label: 'VLD',
      entry: { kind: 'person' },
      pin: {
        kind: 'format',
        formatId: 'value',
        formatVersion: 2,
        ballotDefinition: { id: id('b'), version: 3 },
      },
    },
    {
      type: 'add-event',
      lobbyId,
      name: 'Novice Policy',
      label: null,
      entry: { kind: 'team', size: 2 },
      pin: {
        kind: 'format',
        formatId: 'policy',
        formatVersion: 1,
        ballotDefinition: null,
      },
    },
    {
      type: 'add-event',
      lobbyId,
      name: 'Public Forum',
      label: 'PF',
      entry: { kind: 'team', size: 2 },
      pin: { kind: 'template', templateId: id('t') },
    },
  ],
  'update-event': [
    {
      type: 'update-event',
      lobbyId,
      eventId: id('e'),
      name: 'Varsity LD',
      label: null,
      ballotDefinition: null,
    },
    {
      type: 'update-event',
      lobbyId,
      eventId: id('e'),
      name: 'Varsity LD',
      label: 'VLD',
      ballotDefinition: { id: id('b'), version: 4 },
    },
  ],
  'remove-event': [{ type: 'remove-event', lobbyId, eventId: id('e') }],
  'add-stage': [
    {
      type: 'add-stage',
      lobbyId,
      eventId: id('e'),
      kind: 'preliminary',
      place: 'online',
      timing: { timing: 'live' },
      division: null,
    },
    {
      type: 'add-stage',
      lobbyId,
      eventId: id('e'),
      kind: 'elimination',
      place: 'in_person',
      timing: { timing: 'windowed', opensAt: at(1), closesAt: at(2) },
      division: 'novice',
    },
  ],
  'update-stage': [
    {
      type: 'update-stage',
      lobbyId,
      stageId: id('g'),
      place: 'online',
      timing: { timing: 'live' },
      division: null,
    },
  ],
  'add-tab-round': [
    {
      type: 'add-tab-round',
      lobbyId,
      stageId: id('g'),
      name: null,
      resolution: null,
    },
    {
      type: 'add-tab-round',
      lobbyId,
      stageId: id('g'),
      name: 'Round 1',
      resolution: { poolId: id('p'), poolResolutionId: id('r') },
    },
  ],
  'update-tab-round': [
    {
      type: 'update-tab-round',
      lobbyId,
      tabRoundId: id('k'),
      name: 'Quarterfinals',
      resolution: { poolId: id('p'), poolResolutionId: null },
    },
  ],
  'add-time-slot': [
    { type: 'add-time-slot', lobbyId, name: 'Saturday 9am', startsAt: at(5) },
  ],
  'update-time-slot': [
    {
      type: 'update-time-slot',
      lobbyId,
      timeSlotId: id('m'),
      name: 'Saturday 10am',
      startsAt: at(5),
    },
  ],
  'remove-time-slot': [
    { type: 'remove-time-slot', lobbyId, timeSlotId: id('m') },
  ],
  'place-tab-round': [
    {
      type: 'place-tab-round',
      lobbyId,
      tabRoundId: id('k'),
      timeSlotId: id('m'),
    },
    { type: 'place-tab-round', lobbyId, tabRoundId: id('k'), timeSlotId: null },
  ],
  'define-ballot': [
    {
      type: 'define-ballot',
      lobbyId,
      ballotDefinition: { kind: 'new', name: 'Open ballot' },
      settings: ballotSettings,
    },
    {
      type: 'define-ballot',
      lobbyId,
      ballotDefinition: { kind: 'revision', ballotDefinitionId: id('b') },
      settings: { ...ballotSettings, points: null, criteria: [] },
    },
  ],
  'add-resolution': [
    {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'existing', poolId: id('p') },
      text: 'This house would abolish the electoral college.',
    },
    {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'new', name: 'Elimination topics' },
      text: 'This house regrets social media.',
    },
  ],
  'retire-resolution': [
    { type: 'retire-resolution', lobbyId, poolResolutionId: id('r') },
  ],
} as const satisfies Record<
  keyof typeof lobbySetupCommandCatalogue,
  readonly unknown[]
>;

const [standing, tournament] = valid['create-lobby'];
const [season] = valid['create-season'];
const [event, , followEvent] = valid['add-event'];
const [, eliminationStage] = valid['add-stage'];
const [newBallot] = valid['define-ballot'];

/** One rejection per constraint, each naming the field that fails. */
const invalid: readonly (readonly [string, unknown, string])[] = [
  ['an unknown command type', { type: 'rename-lobby', lobbyId }, 'type'],
  ['a handle with capitals', { ...standing, handle: 'Valley' }, 'handle'],
  ['a handle ending in a hyphen', { ...standing, handle: 'valley-' }, 'handle'],
  ['a blank name', { ...standing, name: '  ' }, 'name'],
  [
    'a standing lobby with a minors declaration',
    { ...standing, lobby: { kind: 'standing', admitsMinors: true } },
    'lobby',
  ],
  [
    'a tournament without its minors declaration',
    { ...tournament, lobby: { kind: 'tournament' } },
    'lobby.admitsMinors',
  ],
  [
    'an owner of an unknown kind',
    { ...standing, owner: { kind: 'school', organizationId: id('o') } },
    'owner.kind',
  ],
  [
    'moving a tournament to draft',
    { type: 'set-tournament-status', lobbyId, status: 'draft' },
    'status',
  ],
  [
    'cancelling through the status command',
    { type: 'set-tournament-status', lobbyId, status: 'cancelled' },
    'status',
  ],
  [
    'closing without a reason',
    { type: 'close-lobby', lobbyId, reason: '' },
    'reason',
  ],
  [
    'a season ending before it starts',
    { ...season, endsAt: at(1), startsAt: at(2) },
    'endsAt',
  ],
  [
    'a season with a local time',
    { ...season, startsAt: '2026-12-01T09:00:00+02:00' },
    'startsAt',
  ],
  ['an unknown counting', { ...season, counting: 'ranking' }, 'counting'],
  ['a rule that is not an object', { ...season, rule: [1] }, 'rule'],
  [
    'an enabled ladder with no name',
    { ...valid['set-ladder'][0], ladder: { enabled: true } },
    'ladder.name',
  ],
  [
    'a Room create that is not one',
    { ...valid['create-lobby-room'][0], room: { title: 'x' } },
    'room.commandId',
  ],
  ['a malformed id', { ...valid['remove-event'][0], eventId: 'E1' }, 'eventId'],
  [
    'a team of one',
    { ...event, entry: { kind: 'team', size: 1 } },
    'entry.size',
  ],
  [
    'a person entry with a size',
    { ...event, entry: { kind: 'person', size: 1 } },
    'entry',
  ],
  [
    'a format pin with no version',
    {
      ...event,
      pin: { kind: 'format', formatId: 'value', ballotDefinition: null },
    },
    'pin.formatVersion',
  ],
  [
    'a template pin that also names a format',
    {
      ...followEvent,
      pin: { kind: 'template', templateId: id('t'), formatId: 'value' },
    },
    'pin',
  ],
  ['a long label', { ...event, label: 'VARSITY-LD-OPEN' }, 'label'],
  [
    'a preliminary stage for a division',
    { ...eliminationStage, kind: 'preliminary' },
    'division',
  ],
  [
    'a window that closes before it opens',
    {
      ...eliminationStage,
      timing: { timing: 'windowed', opensAt: at(2), closesAt: at(1) },
    },
    'timing.closesAt',
  ],
  [
    'a live stage with a window',
    { ...eliminationStage, timing: { timing: 'live', opensAt: at(1) } },
    'timing',
  ],
  [
    'changing a stage structure',
    { ...valid['update-stage'][0], kind: 'elimination' },
    '(root)',
  ],
  [
    'a wording with no pool',
    { ...valid['add-tab-round'][0], resolution: { poolResolutionId: id('r') } },
    'resolution.poolId',
  ],
  [
    'a slot with no start',
    { type: 'add-time-slot', lobbyId, name: 'Saturday' },
    'startsAt',
  ],
  [
    'a placement with no tab round',
    { type: 'place-tab-round', lobbyId, timeSlotId: null },
    'tabRoundId',
  ],
  [
    'a ballot deciding nothing',
    {
      ...newBallot,
      settings: {
        ...ballotSettings,
        points: null,
        ranks: false,
        criteria: [],
        outcomes: { winner: false, doubleLoss: false },
      },
    },
    'settings',
  ],
  [
    'points with an inverted range',
    {
      ...newBallot,
      settings: {
        ...ballotSettings,
        points: { min: 30, max: 20, step: 1, lowPointWin: false },
      },
    },
    'settings.points.max',
  ],
  [
    'a step that does not divide the range',
    {
      ...newBallot,
      settings: {
        ...ballotSettings,
        points: { min: 20, max: 30, step: 0.3, lowPointWin: false },
      },
    },
    'settings.points.step',
  ],
  [
    'a criterion named twice',
    {
      ...newBallot,
      settings: { ...ballotSettings, criteria: ['Delivery', 'Delivery'] },
    },
    'settings.criteria',
  ],
  [
    'criteria without points',
    { ...newBallot, settings: { ...ballotSettings, points: null } },
    'settings.criteria',
  ],
  [
    'a required private note',
    {
      ...newBallot,
      settings: {
        ...ballotSettings,
        written: { ...ballotSettings.written, privateNote: 'required' },
      },
    },
    'settings.written.privateNote',
  ],
  [
    'a resolution over 300 characters',
    { ...valid['add-resolution'][0], text: 'x'.repeat(301) },
    'text',
  ],
];

describe('lobby and setup commands', () => {
  test('accepts every valid payload of every command', () => {
    const accepted = Object.values(valid).flat();
    assert({
      given: 'one example per command and per variant',
      should: 'parse each to itself',
      actual: parseEach(lobbySetupCommandSchema, accepted),
      expected: parsedUnchanged(accepted),
    });
  });

  test('rejects each invalid payload at the field that fails', () => {
    for (const [given, input, path] of invalid)
      assert({
        given,
        should: `reject it at ${path}`,
        actual: parseEach(lobbySetupCommandSchema, [
          input,
        ])[0]?.issues?.includes(path),
        expected: true,
      });
  });

  test('refuses an unknown key on every command', () => {
    const extended = Object.values(valid).map((examples) => ({
      ...examples[0],
      actorId: id('a'),
    }));
    assert({
      given: 'each command with an actor id it may not carry',
      should: 'refuse every one',
      actual: parseEach(lobbySetupCommandSchema, extended).every(
        (outcome) => 'issues' in outcome,
      ),
      expected: true,
    });
  });

  test('wraps every command in the one envelope', () => {
    const envelope = {
      version: 1,
      commandId: id('c'),
      expected: { lobby: 3 },
      command: valid['add-event'][0],
    };
    assert({
      given: 'an add-event envelope, and the same naming an unknown version',
      should: 'accept the first and refuse the second',
      actual: parseEach(lobbySetupCommandEnvelopeSchema, [
        envelope,
        { ...envelope, expected: { tournament: 3 } },
      ]).map((outcome) => 'data' in outcome),
      expected: [true, false],
    });
  });

  test('names every refusal from the group list, and no shared one', () => {
    const named = Object.values(lobbySetupCommandCatalogue).flatMap(
      (definition) => definition.refusals,
    );
    const group: readonly string[] = lobbySetupRefusals;
    const shared: readonly string[] = sharedLobbyRefusals;
    assert({
      given: 'every refusal the catalogue names',
      should: 'be in the group list and not a shared refusal',
      actual: named.filter(
        (refusal) => !group.includes(refusal) || shared.includes(refusal),
      ),
      expected: [],
    });
    assert({
      given: 'the group list',
      should: 'name only refusals some command can give',
      actual: lobbySetupRefusals.filter((refusal) => !named.includes(refusal)),
      expected: [],
    });
  });

  test('one create command makes either kind of lobby', () => {
    assert({
      given: 'the catalogue',
      should: 'have one lobby create command and no other',
      actual: Object.keys(lobbySetupCommandCatalogue).filter((type) =>
        type.startsWith('create-lobby'),
      ),
      expected: ['create-lobby', 'create-lobby-room'],
    });
  });
});

describe('the tournament lifecycle', () => {
  const moves = tournamentStatuses.flatMap((from) =>
    tournamentStatusMoves
      .filter((to) => isTournamentStatusForward(from, to))
      .map((to) => `${from}->${to}`),
  );
  test('moves forward only', () => {
    assert({
      given: 'every status and every move',
      should: 'allow exactly the forward moves, none from cancelled',
      actual: moves,
      expected: [
        'draft->open',
        'draft->running',
        'draft->completed',
        'open->running',
        'open->completed',
        'running->completed',
      ],
    });
  });
  test('is cancelled from any status but completed', () => {
    assert({
      given: 'every status',
      should: 'be cancellable until completed, and not again once cancelled',
      actual: tournamentStatuses.filter(isTournamentCancellable),
      expected: ['draft', 'open', 'running'],
    });
  });
});
