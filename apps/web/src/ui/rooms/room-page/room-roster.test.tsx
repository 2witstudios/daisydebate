import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgeSeat, sideSeat, type RoomView } from '@daisy/protocol';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { idle } from '../../../features/forms/form-state';
import { botsForSeat, RoomRoster } from './room-roster';
import { seatIntents } from './seat-intents.test-support';

setupRitewayBun();

type Participant = RoomView['participants'][number];

const viewer = { actorId: 'v'.repeat(24), label: 'Viewer' };
const judgeBot = {
  actorId: 't'.repeat(24),
  kind: 'bot' as const,
  label: 'Penny',
  aiRole: 'judge' as const,
  eligible: true,
};
const debaterBot = {
  ...judgeBot,
  actorId: 'q'.repeat(24),
  aiRole: 'debater' as const,
};

const seated = (
  id: string,
  role: 'affirmative' | 'negative' | 'judge',
  slot: number,
  more: Partial<Extract<Participant, { actorId: string }>> = {},
): Participant => ({
  id: id.repeat(24),
  actorId: id === 'v' ? viewer.actorId : `${id}a`.repeat(12),
  label: `Member ${id}`,
  consentVersion: 0,
  kind: 'human',
  seat: role === 'judge' ? judgeSeat(slot) : sideSeat(role, slot),
  teamOpen: false,
  positionOpen: false,
  rating: null,
  needsReady: true,
  ready: 'not-ready',
  eligible: true,
  ...more,
});

const intents = {
  action: seatIntents.action,
  invitationAction: async () => idle(),
  commandIds: { seats: seatIntents.commandIds, sides: 'sides', leave: 'leave' },
};

const render = (
  view: RoomView,
  bots: Parameters<typeof RoomRoster>[0]['bots'] = [],
  actorId = viewer.actorId,
) =>
  renderToStaticMarkup(
    <RoomRoster
      view={view}
      viewer={{ ...viewer, actorId }}
      bots={bots}
      footer={<p>footer</p>}
      {...intents}
    />,
  );

const seatsOf = (affirmative: number, negative: number, judges: number) => ({
  sides: { affirmative, negative },
  speakers: 0,
  judges,
  moderators: 0 as const,
});

/** A Room seating `affirmative` and `negative` debaters, no judge. */
const sized = (
  affirmative: number,
  negative: number,
  participants: readonly Participant[],
  more: Partial<RoomView> = {},
): RoomView => ({
  ...assemblySnapshot,
  hostActorId: viewer.actorId,
  definition: {
    ...assemblySnapshot.definition,
    seats: seatsOf(affirmative, negative, 0),
  },
  rules: {
    ...assemblySnapshot.rules,
    seats: seatsOf(affirmative, negative, 0),
  },
  participants,
  teamOneSide: null,
  ...more,
});

/** The hidden fields of the form whose command id is `id`. */
const formOf = (html: string, id: string) => {
  const at = html.indexOf(`value="${id}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf('<form', at);
  return html.slice(start, html.indexOf('</form>', at));
};
const field = (form: string | null, name: string) =>
  form?.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? null;

describe('RoomRoster columns', () => {
  test('a 1 v 1 Room', () => {
    const html = render(
      sized(1, 1, [seated('v', 'affirmative', 0), seated('o', 'negative', 0)]),
    );
    assert({
      given: 'one debater a side',
      should: 'show Side alone, both on ?',
      actual: {
        team: html.includes('>Team<'),
        position: html.includes('>Position<'),
        side: html.includes('>Side<'),
        open: (html.match(/>\?</g) ?? []).length,
      },
      expected: { team: false, position: false, side: true, open: 2 },
    });
  });

  test('a 2 v 2 Room', () => {
    const html = render(
      sized(
        2,
        2,
        [
          seated('v', 'affirmative', 0),
          seated('w', 'affirmative', 1, { positionOpen: true }),
          seated('o', 'negative', 0, { teamOpen: true, positionOpen: true }),
        ],
        { teamOneSide: 'negative' },
      ),
    );
    assert({
      given: 'two seats a side, team 1 fixed on Negative and some ? boxes',
      should:
        'show Team, Side and Position, team 2 on Affirmative, and ? where open',
      actual: {
        columns: ['>Team<', '>Side<', '>Position<'].map((c) =>
          html.includes(c),
        ),
        sides: html.match(/side: [A-Za-z ]+/g),
        positions: html.match(/position: [0-9a-z]+/g),
        open: html.includes('>Open<'),
      },
      expected: {
        columns: [true, true, true],
        sides: ['side: Neg', 'side: Neg', 'side: coin flip'],
        positions: ['position: 1st', 'position: random', 'position: random'],
        open: true,
      },
    });
  });
});

describe('RoomRoster boxes', () => {
  const twoVsTwo = sized(2, 2, [
    seated('v', 'affirmative', 0),
    seated('w', 'affirmative', 1),
    seated('o', 'negative', 0),
  ]);

  test('the viewer’s own row', () => {
    const html = render(twoVsTwo, [], 'w'.repeat(24));
    const own = { ...twoVsTwo, hostActorId: 'h'.repeat(24) };
    const member = render(own, [], 'wa'.repeat(12));
    assert({
      given: 'a member who is not the host',
      should: 'let them change only their own row',
      actual: {
        team: field(formOf(member, 'team-1'), 'participantId'),
        others: [formOf(member, 'team-0'), formOf(member, 'team-3')],
        unknownViewer: formOf(html, 'team-1'),
      },
      expected: {
        team: 'w'.repeat(24),
        others: [null, null],
        unknownViewer: null,
      },
    });
  });

  test('the row action', () => {
    const html = render(twoVsTwo);
    const own = formOf(html, 'leave');
    assert({
      given: 'the host seated on team 1 beside two other debaters',
      should:
        'offer Leave seat on their own row and Remove on each other occupied row',
      actual: {
        leave: [field(own, 'type'), html.includes('aria-label="Leave seat"')],
        remove: (html.match(/aria-label="Remove /g) ?? []).length,
      },
      expected: { leave: ['leave-seat', true], remove: 2 },
    });
  });

  test('cycling a box', () => {
    const html = render(twoVsTwo);
    const team = formOf(html, 'team-0');
    const position = formOf(html, 'position-1');
    const sides = formOf(html, 'sides');
    assert({
      given: 'the host, team 1 in both its seats and the sides on ?',
      should:
        'post team 2 with position ?, position ? after the last, and Affirmative after ?',
      actual: {
        team: [
          field(team, 'type'),
          field(team, 'team'),
          field(team, 'position'),
        ],
        position: [field(position, 'team'), field(position, 'position')],
        sides: [field(sides, 'type'), field(sides, 'teamOneSide')],
      },
      expected: {
        team: ['set-seat', '2', ''],
        position: ['1', ''],
        sides: ['set-sides', 'affirmative'],
      },
    });
  });

  test('sides the Room may not change', () => {
    const unequal = render(
      sized(2, 3, [seated('v', 'affirmative', 0)], {
        teamOneSide: 'affirmative',
      }),
    );
    const ranked = render({
      ...twoVsTwo,
      competitionType: 'ranked',
    });
    assert({
      given: 'teams of different sizes, then a ranked Room',
      should: 'show the side with no way to change it',
      actual: [formOf(unequal, 'sides'), formOf(ranked, 'sides')],
      expected: [null, null],
    });
  });
});

describe('RoomRoster rows', () => {
  const occupied: RoomView = {
    ...assemblySnapshot,
    participants: [
      seated('v', 'affirmative', 1, {
        ready: 'ready',
        rating: { value: 1500, provisional: true },
      }),
      seated('b', 'judge', 0, {
        actorId: judgeBot.actorId,
        kind: 'bot',
        label: 'Judge bot',
        needsReady: false,
        eligible: false,
      }),
    ],
  };

  test('readiness and who sits where', () => {
    const html = render(occupied);
    assert({
      given:
        'two aff and three neg seats, a ready viewer with a provisional rating and an ineligible bot judge',
      should:
        'show all six seats, the real Ready marks, the rating inline and who each is',
      actual: {
        rows: (html.match(/<li /g) ?? []).length,
        open: (html.match(/>Open</g) ?? []).length,
        ready: (html.match(/aria-label="Ready"/g) ?? []).length,
        rating: /class="[^"]*italic[^"]*">1500\*</.test(html),
        you: html.includes('>You<'),
        bot: html.includes('Bot · Not eligible'),
      },
      expected: {
        rows: 6,
        open: 4,
        ready: 2,
        rating: true,
        you: true,
        bot: true,
      },
    });
  });

  test('an anonymous human judge (DEC-174)', () => {
    const html = render({
      ...occupied,
      participants: [
        occupied.participants[0]!,
        {
          seat: { kind: 'judge', slot: 0 },
          kind: 'human',
          anonymous: true,
          needsReady: true,
          ready: 'ready',
          eligible: true,
        },
      ],
    });
    assert({
      given: 'a debater’s view of a seated, ready human judge',
      should: 'show the seat as Judge, ready, with no name',
      actual: [
        html.includes('>Judge<'),
        (html.match(/aria-label="Ready"/g) ?? []).length,
        html.includes('undefined'),
      ],
      expected: [true, 2, false],
    });
  });
});

describe('RoomRoster open seats', () => {
  test('a judge seat for the host and a guest', () => {
    const host = render({ ...assemblySnapshot, aiJudgeSeating: 'included' }, [
      judgeBot,
    ]);
    const guest = render(
      {
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, host: false },
      },
      [judgeBot],
    );
    const ai = formOf(host, 'ai-5');
    assert({
      given: 'an open judge seat seen by the host and by a guest',
      should:
        'offer Take seat and Invite to both, and the AI judge and Seat picker to the host alone',
      actual: [
        host.includes('aria-label="Take Judge 1"'),
        host.includes(`href="/rooms/${assemblySnapshot.id}"`),
        field(ai, 'actorId'),
        field(ai, 'seat'),
        guest.includes('aria-label="Take Judge 1"'),
        guest.includes('>Invite</a>'),
        guest.includes('AI judge'),
        guest.includes('Seat…'),
      ],
      expected: [
        true,
        true,
        judgeBot.actorId,
        JSON.stringify(judgeSeat()).replaceAll('"', '&quot;'),
        true,
        true,
        false,
        false,
      ],
    });
  });

  test('a casual host without the entitlement (WATCH-16)', () => {
    const html = render({ ...assemblySnapshot, aiJudgeSeating: 'premium' }, [
      judgeBot,
    ]);
    assert({
      given: 'an open judge seat seen by a casual host without the entitlement',
      should: 'offer a person, not the AI judge, and keep Invite',
      actual: [
        html.includes('>AI judge</button>'),
        formOf(html, 'assign-5')?.includes(judgeBot.actorId) ?? false,
        html.includes('>Invite</a>'),
        html.includes('AI judging on casual rounds is premium'),
      ],
      expected: [false, false, true, true],
    });
  });

  test('bots offered only for the seats they may hold', () => {
    const casual = render(assemblySnapshot, [debaterBot]);
    const ranked = render({ ...assemblySnapshot, competitionType: 'ranked' }, [
      debaterBot,
    ]);
    assert({
      given: 'a bot debater in the cast choices, casual then ranked',
      should:
        'offer it for debater seats in a casual Room only, never as the AI judge (ISSUE-750)',
      actual: [
        formOf(casual, 'assign-0')?.includes(debaterBot.actorId) ?? false,
        formOf(casual, 'assign-5')?.includes(debaterBot.actorId) ?? false,
        casual.includes('>AI judge</button>'),
        formOf(ranked, 'assign-0')?.includes(debaterBot.actorId) ?? false,
      ],
      expected: [true, false, false, false],
    });
  });

  test('a seat kept for an invitation', () => {
    const invited = {
      ...assemblySnapshot,
      invitations: [
        {
          id: 'i'.repeat(24),
          seat: 'judge' as const,
          invitee: 'ana',
          inviter: 'Host',
          expiresAt: '2026-11-16T12:00:00.000Z',
        },
      ],
    };
    const host = render(invited);
    const guest = render({
      ...invited,
      capabilities: { ...invited.capabilities, host: false },
    });
    assert({
      given: 'a pending judge invitation, seen by the host and by a guest',
      should:
        'name the invitee on the open judge seat, and let the host alone release it',
      actual: {
        named: [host.includes('Invited: ana'), guest.includes('Invited: ana')],
        release: [
          host.includes('>Release<') &&
            host.includes(`name="invitationId" value="${'i'.repeat(24)}"`),
          guest.includes('>Release<'),
        ],
      },
      expected: { named: [true, true], release: [true, false] },
    });
  });
});

describe('RoomRoster in any format (TAB-6)', () => {
  test('a speaker seat offers the bot debaters, a moderator seat no AI (TAB-6.18)', () => {
    const bot = (actorId: string, aiRole: 'debater' | 'judge') => ({
      actorId: actorId.repeat(24),
      kind: 'bot' as const,
      label: actorId,
      aiRole,
      eligible: true,
    });
    const bots = [bot('w', 'debater'), bot('j', 'judge')];
    const offered = (seat: Parameters<typeof botsForSeat>[1]) =>
      botsForSeat(bots, seat).map((choice) => choice.label);
    assert({
      given: 'a bot debater and the AI judge, for each kind of seat',
      should:
        'offer the bot debater for side and speaker seats, the AI judge for a judge seat, and nobody for a moderator seat',
      actual: [
        offered({ kind: 'side', side: 'negative', slot: 0 }),
        offered({ kind: 'speaker', slot: 2 }),
        offered({ kind: 'judge', slot: 0 }),
        offered({ kind: 'moderator', slot: 0 }),
      ],
      expected: [['w'], ['w'], ['j'], []],
    });
  });

  test('a four-team Room lists each bench by its own name, in declared order (TAB-6.17)', () => {
    const sides = [
      { key: 'opening_government', label: 'Opening Government', short: 'OG' },
      { key: 'opening_opposition', label: 'Opening Opposition', short: 'OO' },
      { key: 'closing_government', label: 'Closing Government', short: 'CG' },
      { key: 'closing_opposition', label: 'Closing Opposition', short: 'CO' },
    ];
    const seats = {
      sides: Object.fromEntries(sides.map((side) => [side.key, 1])),
      speakers: 0,
      judges: 2,
      moderators: 0 as const,
    };
    const html = render({
      ...assemblySnapshot,
      participants: [],
      definition: { ...assemblySnapshot.definition, sides, seats },
      rules: { ...assemblySnapshot.rules, sides, seats },
    });
    const rows = [...html.matchAll(/<li aria-label="([^"]+)"/g)].map(
      ([, text]) => text,
    );
    assert({
      given: 'four one-seat benches and a panel of two, all open',
      should: 'name each seat by the format’s labels, benches first',
      actual: rows,
      expected: [
        'Opening Government 1',
        'Opening Opposition 1',
        'Closing Government 1',
        'Closing Opposition 1',
        'Judge 1',
        'Judge 2',
      ],
    });
  });
});

describe('RoomRoster with no two teams (TAB-6.2)', () => {
  const benches = [
    { key: 'opening_government', label: 'Opening Government', short: 'OG' },
    { key: 'opening_opposition', label: 'Opening Opposition', short: 'OO' },
    { key: 'closing_government', label: 'Closing Government', short: 'CG' },
    { key: 'closing_opposition', label: 'Closing Opposition', short: 'CO' },
  ];
  const benchSeats = {
    sides: Object.fromEntries(benches.map((side) => [side.key, 1])),
    speakers: 0,
    judges: 0,
    moderators: 0 as const,
  };

  test('seated benches', () => {
    const html = render({
      ...assemblySnapshot,
      hostActorId: viewer.actorId,
      teamOneSide: 'affirmative',
      definition: {
        ...assemblySnapshot.definition,
        sides: benches,
        seats: benchSeats,
      },
      rules: { ...assemblySnapshot.rules, sides: benches, seats: benchSeats },
      participants: benches.map((side, i) => ({
        ...seated(String.fromCharCode(118 + i), 'affirmative', 0),
        seat: { kind: 'side' as const, side: side.key, slot: 0 },
      })),
    });
    assert({
      given: 'four benches, each seated, seen by the host on their own bench',
      should: 'show no Team, Side or Position box: every seat is its side',
      actual: [
        html.includes('&#x27;s team:'),
        html.includes('&#x27;s side:'),
        html.includes('&#x27;s position:'),
        formOf(html, 'sides'),
      ],
      expected: [false, false, false, null],
    });
  });

  test('a speaker seat kept for an invitation', () => {
    const speakers = {
      sides: {},
      speakers: 3,
      judges: 0,
      moderators: 0 as const,
    };
    const html = render({
      ...assemblySnapshot,
      definition: {
        ...assemblySnapshot.definition,
        sides: [],
        seats: speakers,
      },
      rules: { ...assemblySnapshot.rules, sides: [], seats: speakers },
      participants: [],
      invitations: [
        {
          id: 'i'.repeat(24),
          seat: 'speaker',
          invitee: 'ana',
          inviter: 'Host',
          expiresAt: '2026-11-16T12:00:00.000Z',
        },
      ],
    });
    assert({
      given: 'a speakers-only Room with a pending speaker invitation',
      should:
        'name the invitee on the first open speaker seat, for the host to release',
      actual: [
        (html.match(/Invited: ana/g) ?? []).length,
        html.includes('>Release<'),
      ],
      expected: [1, true],
    });
  });
});

describe('RoomRoster in an event Room (ADR 0145, Tab)', () => {
  // A published event Room: the organiser seated it from the draw and
  // nobody hosts it; its sides are fixed as drawn.
  const event: RoomView = {
    ...sized(
      1,
      1,
      [seated('v', 'affirmative', 0), seated('o', 'negative', 0)],
      { teamOneSide: 'affirmative' },
    ),
    hostActorId: null,
    hostLabel: null,
    capabilities: { ...assemblySnapshot.capabilities, host: false },
  };

  test('a seated debater', () => {
    const html = render(event);
    assert({
      given: 'a debater seated by the organiser in an event Room',
      should:
        'say who seated it, show their side by name and offer no way to change seat, side or position, or to leave',
      actual: {
        note: html.includes('Seated by the organiser'),
        side: html.includes('aria-label="Member v&#x27;s side: Aff"'),
        sides: formOf(html, 'sides'),
        team: formOf(html, 'team-0'),
        leave: html.includes('Leave seat'),
      },
      expected: {
        note: true,
        side: true,
        sides: null,
        team: null,
        leave: false,
      },
    });
  });

  test('an open seat', () => {
    const html = render({
      ...event,
      participants: [seated('o', 'negative', 0)],
    });
    assert({
      given: 'an event Room seat the organiser has not filled yet',
      should: 'offer no Take seat and no Invite',
      actual: [html.includes('Take seat'), html.includes('>Invite</a>')],
      expected: [false, false],
    });
  });
});
