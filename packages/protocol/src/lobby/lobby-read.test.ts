import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { z } from 'zod';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  lobbyLadderSchema,
  lobbyListPageSchema,
  lobbyReadCatalogue,
  lobbyRoomListQuerySchema,
  lobbyRoomListSchema,
  lobbyViewSchema,
} from './lobby-read';

setupRitewayBun();

const verdict = (schema: z.ZodType, input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'accepted' : parsed.issues;
};

const id = (c: string) => c.repeat(24);
const at = '2026-11-14T10:00:00.000Z';
const league = {
  kind: 'organization',
  organizationId: id('o'),
  organizationKind: 'league',
  name: 'Southeast League',
};
const entry = {
  opensAt: null,
  closesAt: '2026-11-12T17:00:00.000Z',
  capacity: 48,
  taken: 31,
  eligibility: 'organization_added',
  limit: null,
};
const round = {
  tabRoundId: id('r'),
  eventId: id('e'),
  number: 4,
  name: null,
  stage: 'preliminary',
};

const standing = {
  kind: 'standing',
  lobbyId: id('l'),
  handle: 'southeast',
  name: 'Southeast League',
  owner: league,
  signedIn: true,
  viewerRoles: ['member'],
  asOf: at,
  resolutionPool: {
    name: 'November',
    resolutions: 30,
    theme: 'cities and transport',
    perRoom: 5,
  },
  season: '2026 to 27',
  offeredTemplates: [{ templateId: id('t'), name: 'Varsity debate' }],
  ladder: { rating: 1548, place: 31, of: 148 },
  capabilities: { createRoom: true },
};

const tournament = {
  kind: 'tournament',
  lobbyId: id('a'),
  handle: 'autumn-open',
  name: 'Autumn Open',
  owner: league,
  signedIn: true,
  viewerRoles: ['competitor'],
  asOf: at,
  status: 'running',
  startsAt: at,
  place: 'online',
  certifiedAt: null,
  entry,
  entered: {
    kind: 'schools',
    schools: [{ name: 'Ridgeview', entries: 9 }],
    more: 5,
  },
  terms: [
    { title: 'One judge a room', detail: 'Three in elimination rounds.' },
  ],
  events: [{ eventId: id('e'), name: 'Varsity debate' }],
  timeSlots: [
    {
      timeSlotId: id('s'),
      name: 'Round 4',
      startsAt: at,
      tabRounds: [{ ...round, posting: true }],
    },
  ],
  break: { at, announced: false },
  viewerEntries: [
    {
      entryId: id('n'),
      eventId: id('e'),
      name: 'Doyle',
      partners: [],
      record: { wins: 2, losses: 1 },
      finish: null,
    },
  ],
  wards: [],
  school: null,
  results: {
    standings: true,
    bracket: 'not_drawn',
    scoresOpenAt: 'prelims_end',
  },
  host: null,
  capabilities: { enter: false, manageEntries: false },
};

const hostPart = {
  setupUnfinished: 0,
  entryCount: 48,
  slots: [{ timeSlotId: id('s'), state: { kind: 'needs_host', count: 2 } }],
  breakState: 'pending',
  certified: false,
};

describe('the lobby view (TAB-5.14)', async () => {
  test('one contract for both kinds', async () => {
    assert({
      given: 'a standing lobby and a tournament',
      should: 'parse both under the one lobby contract, by kind',
      actual: [
        verdict(lobbyViewSchema, standing),
        verdict(lobbyViewSchema, tournament),
      ],
      expected: ['accepted', 'accepted'],
    });
    assert({
      given:
        'a standing lobby carrying a tournament field, and an unknown kind',
      should: 'refuse each',
      actual: [
        verdict(lobbyViewSchema, { ...standing, timeSlots: [] }),
        verdict(lobbyViewSchema, { ...standing, kind: 'league' }),
      ],
      expected: [['(root)'], ['kind']],
    });
  });

  test('redaction by audience', async () => {
    assert({
      given:
        "a host's view with what waits on them, a signed-out reader's with no roles, and a viewer the bracket is closed to",
      should: 'accept each variant',
      actual: [
        verdict(lobbyViewSchema, {
          ...tournament,
          viewerRoles: ['host'],
          host: hostPart,
        }),
        verdict(lobbyViewSchema, {
          ...tournament,
          signedIn: false,
          viewerRoles: [],
          viewerEntries: [],
        }),
        verdict(lobbyViewSchema, {
          ...tournament,
          results: { standings: false, bracket: 'closed', scoresOpenAt: null },
        }),
      ],
      expected: ['accepted', 'accepted', 'accepted'],
    });
    assert({
      given:
        'a viewer role, a slot state and a bracket state outside the vocabulary',
      should: 'refuse each',
      actual: [
        verdict(lobbyViewSchema, { ...tournament, viewerRoles: ['owner'] }),
        verdict(lobbyViewSchema, {
          ...tournament,
          host: {
            ...hostPart,
            slots: [{ timeSlotId: id('s'), state: { kind: 'late' } }],
          },
        }),
        verdict(lobbyViewSchema, {
          ...tournament,
          results: { ...tournament.results, bracket: 'hidden' },
        }),
      ],
      expected: [
        ['viewerRoles.0'],
        ['host.slots.0.state.kind'],
        ['results.bracket'],
      ],
    });
  });
});

const listed = {
  kind: 'tournament',
  lobbyId: id('a'),
  handle: 'autumn-open',
  name: 'Autumn Open',
  owner: league,
  hostedBy: null,
  status: 'running',
  startsAt: at,
  events: ['Varsity debate'],
  concurrentEvents: false,
  entry,
  part: { kind: 'judge', events: ['Varsity debate'] },
  now: { kind: 'round_opens', tabRoundName: 'Round 4', at },
  finish: null,
};

describe('the lobby list (TAB-5.14)', async () => {
  test('parsing', async () => {
    const page = (lobbies: readonly unknown[], capabilities: unknown) => ({
      asOf: at,
      lobbies,
      more: 0,
      capabilities,
    });
    assert({
      given:
        "a signed-in viewer's page of both kinds, a signed-out reader's, and an entry with an empty part",
      should: 'accept the first two and refuse the third',
      actual: [
        verdict(
          lobbyListPageSchema,
          page(
            [
              listed,
              {
                kind: 'standing',
                lobbyId: id('l'),
                handle: 'southeast',
                name: 'Southeast League',
                owner: league,
              },
            ],
            { createLobby: true },
          ),
        ),
        verdict(lobbyListPageSchema, page([{ ...listed, part: null }], null)),
        verdict(
          lobbyListPageSchema,
          page([{ ...listed, part: { kind: 'competitor', events: [] } }], null),
        ),
      ],
      expected: ['accepted', 'accepted', ['lobbies.0.part.events']],
    });
  });
});

describe('the Rooms of a lobby (TAB-5.14)', async () => {
  test('asked of a lobby', async () => {
    const open = {
      status: 'open',
      roomId: id('m'),
      name: "Castillo's room",
      host: { username: 'Castillo', rating: 1655 },
      school: 'Ridgeview',
      open: { debaters: 1, judges: 1 },
      openedAt: at,
      capabilities: { join: true, judge: true },
    };
    const live = {
      status: 'live',
      roomId: id('n'),
      debaters: ['Jensen', 'Wu'],
      judges: ['Okoye'],
      segment: 'Third speech',
      capabilities: { watch: true },
    };
    assert({
      given: 'a query naming the lobby, and one naming none',
      should: 'accept only the lobby query',
      actual: [
        verdict(lobbyRoomListQuerySchema, { lobbyId: id('l') }),
        verdict(lobbyRoomListQuerySchema, {}),
      ],
      expected: ['accepted', ['lobbyId']],
    });
    assert({
      given: 'an open Room and a live one, then a live Room with open seats',
      should: 'accept the list and refuse the live Room carrying seats',
      actual: [
        verdict(lobbyRoomListSchema, {
          lobbyId: id('l'),
          asOf: at,
          rooms: [open, live],
        }),
        verdict(lobbyRoomListSchema, {
          lobbyId: id('l'),
          asOf: at,
          rooms: [{ ...live, open: open.open }],
        }),
      ],
      expected: ['accepted', ['rooms.0']],
    });
  });
});

describe('the lobby ladder (TAB-5.14)', async () => {
  test('parsing', async () => {
    const line = {
      actorId: id('p'),
      place: 31,
      username: 'doyle',
      school: 'Lakeside',
      wins: 14,
      losses: 9,
      rating: 1548,
      change: 12,
    };
    const ladder = {
      lobbyId: id('l'),
      entrants: 148,
      page: 1,
      pages: 25,
      viewer: line,
      lines: [line],
    };
    assert({
      given: 'a page of the ladder, then one with an unknown key',
      should: 'accept the first only',
      actual: [
        verdict(lobbyLadderSchema, ladder),
        verdict(lobbyLadderSchema, { ...ladder, total: 148 }),
      ],
      expected: ['accepted', ['(root)']],
    });
  });

  test('gates', async () => {
    assert({
      given: 'the lobby reads',
      should: 'answer each under one gate',
      actual: lobbyReadCatalogue,
      expected: {
        LobbyListPage: { gate: 'signed-in' },
        LobbyView: { gate: ['lobby.read'] },
        LobbyRoomList: { gate: ['room.list'] },
        LobbyLadder: { gate: ['lobby.read'] },
      },
    });
  });
});
