import type { LobbyCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideLobby, type LobbyFact, type LobbyFacts } from './lobby';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const now = '2026-12-01T09:00:00.000Z';
const leagueId = id('o');

const standing: LobbyFact = {
  kind: 'standing',
  id: id('l'),
  ownerOrganizationId: leagueId,
  closedAt: null,
  version: 4,
};
const tournament = (
  status: Extract<LobbyFact, { kind: 'tournament' }>['status'],
): LobbyFact => ({
  kind: 'tournament',
  id: id('t'),
  ownerOrganizationId: null,
  closedAt: null,
  version: 7,
  status,
  admitsMinors: false,
});

const facts = (overrides: Partial<LobbyFacts> = {}): LobbyFacts => ({
  now,
  newId: id('n'),
  actorUserId: id('u'),
  planAllows: true,
  handleTaken: false,
  organization: { id: leagueId, kind: 'league' },
  lobby: standing,
  activity: {
    liveRoundCount: 0,
    unresultedFixtureCount: 0,
    unstartedEventRoomIds: [],
  },
  activeSeasonId: null,
  season: null,
  ladder: null,
  room: {
    offeredTemplates: [
      {
        id: id('p'),
        formatId: 'value',
        formatVersion: 1,
        ballotDefinitionId: id('b'),
        ballotDefinitionVersion: 2,
      },
    ],
    ownFormat: 'allowed',
    ownText: 'allowed',
    enforcedVisibility: null,
  },
  ...overrides,
});

const refusalOf = (given: LobbyFacts, command: LobbyCommand) => {
  const decision = decideLobby(given, command);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};
const writesOf = (given: LobbyFacts, command: LobbyCommand) => {
  const decision = decideLobby(given, command);
  return decision.kind === 'accepted'
    ? {
        aggregate: decision.aggregate,
        version: decision.resultingVersion,
        writes: decision.writes,
      }
    : decision.refusal;
};

type Create = Extract<LobbyCommand, { type: 'create-lobby' }>;
const createStanding: Create = {
  type: 'create-lobby',
  owner: { kind: 'organization', organizationId: leagueId },
  name: 'Valley League',
  handle: 'valley-league',
  lobby: { kind: 'standing' },
};
const createTournament: Create = {
  type: 'create-lobby',
  owner: { kind: 'self' },
  name: 'Spring Open',
  handle: 'spring-open',
  lobby: { kind: 'tournament', admitsMinors: true },
};

describe('create-lobby', () => {
  test('one create command makes a standing lobby or a tournament', () => {
    assert({
      given: 'a league creating a standing lobby',
      should: 'write only the lobby, owned by the league',
      actual: writesOf(facts(), createStanding),
      expected: {
        aggregate: { kind: 'lobby', id: id('n') },
        version: 1,
        writes: [
          {
            table: 'lobbies',
            op: 'insert',
            row: {
              id: id('n'),
              kind: 'standing',
              ownerUserId: null,
              ownerOrganizationId: leagueId,
              name: 'Valley League',
              handle: 'valley-league',
            },
          },
        ],
      },
    });
    assert({
      given: 'a person creating a tournament',
      should:
        'write the lobby they own and its draft schedule in the same step',
      actual: writesOf(facts(), createTournament),
      expected: {
        aggregate: { kind: 'lobby', id: id('n') },
        version: 1,
        writes: [
          {
            table: 'lobbies',
            op: 'insert',
            row: {
              id: id('n'),
              kind: 'tournament',
              ownerUserId: id('u'),
              ownerOrganizationId: null,
              name: 'Spring Open',
              handle: 'spring-open',
            },
          },
          {
            table: 'tournaments',
            op: 'insert',
            row: { lobbyId: id('n'), status: 'draft', admitsMinors: true },
          },
        ],
      },
    });
  });

  test('names each refusal', () => {
    assert({
      given: 'each failing create',
      should: 'refuse it by name',
      actual: [
        refusalOf(facts(), { ...createStanding, owner: { kind: 'self' } }),
        refusalOf(facts({ actorUserId: null }), createTournament),
        refusalOf(
          facts({ organization: { id: leagueId, kind: 'school' } }),
          createStanding,
        ),
        refusalOf(facts({ organization: null }), createStanding),
        refusalOf(facts({ planAllows: false }), createTournament),
        refusalOf(facts({ handleTaken: true }), createStanding),
      ],
      expected: [
        'owner-not-organization',
        'owner-not-organization',
        'owner-not-league',
        'not-found',
        'plan-required',
        'handle-taken',
      ],
    });
  });
});

describe('update-lobby', () => {
  const update = {
    type: 'update-lobby',
    lobbyId: id('t'),
    name: 'Spring Open 2027',
    admitsMinors: true,
  } as const;
  test('renames and sets a tournament minors declaration', () => {
    assert({
      given: 'a tournament renamed and opened to minors',
      should: 'write the name and version, and the declaration',
      actual: writesOf(facts({ lobby: tournament('open') }), update),
      expected: {
        aggregate: { kind: 'lobby', id: id('t') },
        version: 8,
        writes: [
          {
            table: 'lobbies',
            op: 'update',
            id: id('t'),
            set: { name: 'Spring Open 2027', version: 8 },
          },
          {
            table: 'tournaments',
            op: 'update',
            id: id('t'),
            set: { admitsMinors: true },
          },
        ],
      },
    });
  });
  test('names each refusal', () => {
    assert({
      given:
        'a standing lobby given a minors declaration, a closed lobby and none',
      should: 'refuse each by name',
      actual: [
        refusalOf(facts(), update),
        refusalOf(facts({ lobby: { ...standing, closedAt: now } }), update),
        refusalOf(facts({ lobby: null }), update),
      ],
      expected: ['lobby-not-tournament', 'lobby-closed', 'not-found'],
    });
  });
});

describe('set-tournament-status', () => {
  const to = (status: 'open' | 'running' | 'completed') =>
    ({ type: 'set-tournament-status', lobbyId: id('t'), status }) as const;
  test('moves a tournament forward', () => {
    assert({
      given: 'an open tournament set running',
      should: 'write the status and move the lobby version',
      actual: writesOf(facts({ lobby: tournament('open') }), to('running')),
      expected: {
        aggregate: { kind: 'lobby', id: id('t') },
        version: 8,
        writes: [
          {
            table: 'tournaments',
            op: 'update',
            id: id('t'),
            set: { status: 'running' },
          },
          { table: 'lobbies', op: 'update', id: id('t'), set: { version: 8 } },
        ],
      },
    });
  });
  test('never moves a tournament backwards, and never reopens a cancelled one', () => {
    assert({
      given:
        'each backward or repeated move, and a move on a cancelled (closed) tournament',
      should: 'refuse it',
      actual: [
        refusalOf(facts({ lobby: tournament('running') }), to('open')),
        refusalOf(facts({ lobby: tournament('completed') }), to('running')),
        refusalOf(facts({ lobby: tournament('open') }), to('open')),
        refusalOf(facts({ lobby: tournament('cancelled') }), to('open')),
        refusalOf(
          facts({ lobby: { ...tournament('cancelled'), closedAt: now } }),
          to('open'),
        ),
      ],
      expected: [
        'status-order',
        'status-order',
        'status-order',
        'status-order',
        'lobby-closed',
      ],
    });
  });
  test('names each other refusal', () => {
    const live = {
      liveRoundCount: 1,
      unresultedFixtureCount: 0,
      unstartedEventRoomIds: [],
    };
    const open = {
      liveRoundCount: 0,
      unresultedFixtureCount: 2,
      unstartedEventRoomIds: [],
    };
    assert({
      given:
        'a standing lobby, completing while a Round runs, and completing with results missing',
      should: 'refuse each by name',
      actual: [
        refusalOf(facts(), to('open')),
        refusalOf(
          facts({ lobby: tournament('running'), activity: live }),
          to('completed'),
        ),
        refusalOf(
          facts({ lobby: tournament('running'), activity: open }),
          to('completed'),
        ),
        refusalOf(
          facts({ lobby: tournament('running'), activity: live }),
          to('running'),
        ),
      ],
      expected: [
        'lobby-not-tournament',
        'rounds-running',
        'results-incomplete',
        'status-order',
      ],
    });
  });
});

describe('close-lobby', () => {
  const close = {
    type: 'close-lobby',
    lobbyId: id('t'),
    reason: 'Venue lost.',
  } as const;
  const activity = {
    liveRoundCount: 0,
    unresultedFixtureCount: 3,
    unstartedEventRoomIds: [id('r')],
  };
  test('closing a tournament cancels it and closes its unstarted event Rooms', () => {
    assert({
      given: 'an open tournament with one unstarted event Room',
      should: 'close the lobby, cancel the tournament and close the Room',
      actual: writesOf(facts({ lobby: tournament('open'), activity }), close),
      expected: {
        aggregate: { kind: 'lobby', id: id('t') },
        version: 8,
        writes: [
          {
            table: 'lobbies',
            op: 'update',
            id: id('t'),
            set: { closedAt: now, version: 8 },
          },
          {
            table: 'tournaments',
            op: 'update',
            id: id('t'),
            set: { status: 'cancelled' },
          },
          {
            table: 'rooms',
            op: 'update',
            id: id('r'),
            set: { status: 'closed' },
          },
        ],
      },
    });
  });
  test('a completed tournament closes without being cancelled, and a standing lobby just closes', () => {
    const decided = [
      writesOf(facts({ lobby: tournament('completed') }), close),
      writesOf(facts(), { ...close, lobbyId: id('l') }),
    ];
    assert({
      given: 'a completed tournament and a standing lobby',
      should: 'only close each lobby',
      actual: decided.map((decision) =>
        typeof decision === 'string'
          ? decision
          : decision.writes.map((write) => write.table),
      ),
      expected: [['lobbies'], ['lobbies']],
    });
  });
  test('names each refusal', () => {
    assert({
      given: 'a Round running, a closed lobby and none',
      should: 'refuse each by name',
      actual: [
        refusalOf(
          facts({
            lobby: tournament('running'),
            activity: { ...activity, liveRoundCount: 1 },
          }),
          close,
        ),
        refusalOf(
          facts({ lobby: { ...tournament('cancelled'), closedAt: now } }),
          close,
        ),
        refusalOf(facts({ lobby: null }), close),
      ],
      expected: ['rounds-running', 'lobby-closed', 'not-found'],
    });
  });
});

describe('seasons', () => {
  const create: Extract<LobbyCommand, { type: 'create-season' }> = {
    type: 'create-season',
    organizationId: leagueId,
    name: '2027 season',
    startsAt: '2027-01-01T00:00:00Z',
    endsAt: null,
    counting: 'sanction',
    countsLobbyRooms: true,
    rule: { best: 5 },
  };
  const close = { type: 'close-season', seasonId: id('s') } as const;
  const season = {
    id: id('s'),
    organizationId: leagueId,
    status: 'active',
    version: 2,
  } as const;
  test('creates a season with its counting rule, and closes it', () => {
    assert({
      given: 'a league with no open season, and then its open season closed',
      should: 'write the season and its rule, then the closed status',
      actual: [writesOf(facts(), create), writesOf(facts({ season }), close)],
      expected: [
        {
          aggregate: { kind: 'season', id: id('n') },
          version: 1,
          writes: [
            {
              table: 'seasons',
              op: 'insert',
              row: {
                id: id('n'),
                organizationId: leagueId,
                name: '2027 season',
                startsAt: '2027-01-01T00:00:00Z',
                endsAt: null,
                status: 'active',
              },
            },
            {
              table: 'season_standing_rules',
              op: 'insert',
              row: {
                seasonId: id('n'),
                organizationId: leagueId,
                counting: 'sanction',
                countsLobbyRooms: true,
                rule: { best: 5 },
              },
            },
          ],
        },
        {
          aggregate: { kind: 'season', id: id('s') },
          version: 3,
          writes: [
            {
              table: 'seasons',
              op: 'update',
              id: id('s'),
              set: { status: 'closed', version: 3 },
            },
          ],
        },
      ],
    });
  });
  test('names each refusal', () => {
    assert({
      given:
        'a season already open, a school, no organization, a closed season and none',
      should: 'refuse each by name',
      actual: [
        refusalOf(facts({ activeSeasonId: id('s') }), create),
        refusalOf(
          facts({ organization: { id: leagueId, kind: 'school' } }),
          create,
        ),
        refusalOf(facts({ organization: null }), create),
        refusalOf(facts({ season: { ...season, status: 'closed' } }), close),
        refusalOf(facts(), close),
      ],
      expected: [
        'season-open',
        'owner-not-league',
        'not-found',
        'season-closed',
        'not-found',
      ],
    });
  });
});

describe('set-ladder', () => {
  const enable = {
    type: 'set-ladder',
    organizationId: leagueId,
    lobbyId: id('l'),
    ladder: { enabled: true, name: 'League ladder' },
  } as const;
  const disable = { ...enable, ladder: { enabled: false } } as const;
  test('turns a league ladder on and off over its own standing lobby', () => {
    assert({
      given: 'a ladder enabled, then disabled',
      should: 'insert the ladder, then delete it, moving the lobby version',
      actual: [
        writesOf(facts(), enable),
        writesOf(facts({ ladder: { id: id('d') } }), disable),
      ],
      expected: [
        {
          aggregate: { kind: 'lobby', id: id('l') },
          version: 5,
          writes: [
            {
              table: 'ladders',
              op: 'insert',
              row: {
                id: id('n'),
                lobbyId: id('l'),
                organizationId: leagueId,
                name: 'League ladder',
              },
            },
            {
              table: 'lobbies',
              op: 'update',
              id: id('l'),
              set: { version: 5 },
            },
          ],
        },
        {
          aggregate: { kind: 'lobby', id: id('l') },
          version: 5,
          writes: [
            { table: 'ladders', op: 'delete', id: id('d') },
            {
              table: 'lobbies',
              op: 'update',
              id: id('l'),
              set: { version: 5 },
            },
          ],
        },
      ],
    });
  });
  test('names each refusal', () => {
    assert({
      given:
        "a tournament, another league's lobby, and a ladder already as asked",
      should: 'refuse each by name',
      actual: [
        refusalOf(facts({ lobby: tournament('open') }), enable),
        refusalOf(
          facts({ lobby: { ...standing, ownerOrganizationId: id('x') } }),
          enable,
        ),
        refusalOf(facts({ ladder: { id: id('d') } }), enable),
        refusalOf(facts(), disable),
      ],
      expected: [
        'lobby-not-standing',
        'ladder-foreign',
        'ladder-unchanged',
        'ladder-unchanged',
      ],
    });
  });
});

describe('create-lobby-room', () => {
  const room = {
    commandId: id('c'),
    title: 'Friday practice',
    resolution: { kind: 'policy', id: id('q') },
    visibility: 'public',
    selection: {
      kind: 'catalog',
      formatId: 'value',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual',
    },
  } as const;
  const withTemplate = {
    type: 'create-lobby-room',
    lobbyId: id('l'),
    templateId: id('p'),
    room,
  } as const;
  const ownFormat = { ...withTemplate, templateId: null } as const;
  const roomFacts = facts().room;
  test('makes a Room following an offered template, or in the host format', () => {
    assert({
      given: 'a Room following an offered template, and one in its own format',
      should:
        "pin the template's ballot definition, or none, without moving the lobby version",
      actual: [writesOf(facts(), withTemplate), writesOf(facts(), ownFormat)],
      expected: [
        {
          aggregate: { kind: 'lobby', id: id('l') },
          version: 4,
          writes: [
            {
              table: 'rooms',
              op: 'insert',
              row: {
                id: id('n'),
                lobbyId: id('l'),
                lobbyKind: 'standing',
                templateId: id('p'),
                ballotDefinitionId: id('b'),
                ballotDefinitionVersion: 2,
              },
              create: room,
            },
          ],
        },
        {
          aggregate: { kind: 'lobby', id: id('l') },
          version: 4,
          writes: [
            {
              table: 'rooms',
              op: 'insert',
              row: {
                id: id('n'),
                lobbyId: id('l'),
                lobbyKind: 'standing',
                templateId: null,
                ballotDefinitionId: null,
                ballotDefinitionVersion: null,
              },
              create: room,
            },
          ],
        },
      ],
    });
  });
  test('names each refusal', () => {
    assert({
      given: 'each failing Room create',
      should: 'refuse it by name',
      actual: [
        refusalOf(facts({ lobby: tournament('open') }), withTemplate),
        refusalOf(facts(), { ...withTemplate, templateId: id('z') }),
        refusalOf(
          facts({ room: { ...roomFacts, ownFormat: 'off' } }),
          ownFormat,
        ),
        refusalOf(facts(), {
          ...withTemplate,
          room: {
            ...room,
            selection: { ...room.selection, formatId: 'policy' },
          },
        }),
        refusalOf(
          facts({ room: { ...roomFacts, enforcedVisibility: 'unlisted' } }),
          withTemplate,
        ),
        refusalOf(facts({ room: { ...roomFacts, ownText: 'off' } }), {
          ...withTemplate,
          room: {
            ...room,
            resolution: { kind: 'custom', text: 'My own motion.' },
          },
        }),
        refusalOf(
          facts({ lobby: { ...standing, closedAt: now } }),
          withTemplate,
        ),
      ],
      expected: [
        'lobby-not-standing',
        'template-not-offered',
        'template-required',
        'template-format-mismatch',
        'setting-enforced',
        'pool-resolution-required',
        'lobby-closed',
      ],
    });
  });
});
