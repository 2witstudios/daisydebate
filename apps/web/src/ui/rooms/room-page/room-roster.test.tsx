import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgeSeat, sideSeat, type RoomView } from '@daisy/protocol';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { idle } from '../../../features/forms/form-state';
import { botsForSeat, RoomRoster } from './room-roster';
import { seatIntents } from './seat-intents.test-support';

setupRitewayBun();

type Participant = RoomView['participants'][number];

const viewer = {
  actorId: 'v'.repeat(24),
  label: 'Viewer',
};
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
      view={{
        ...view,
        viewerMayDebate: view.viewerMayDebate ?? view.ageRule === 'adults',
      }}
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
        bot: html.includes('>Bot<') && html.includes('>Not eligible<'),
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
        html.includes('AI judging on casual Rounds is Premium'),
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
      participants: benches.map((side, i): Participant => ({
        ...(seated(String.fromCharCode(118 + i), 'affirmative', 0) as Extract<
          Participant,
          { actorId: string }
        >),
        seat: { kind: 'side', side: side.key, slot: 0 },
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

  test('a four-team (BP) row in the compact layout (main-sync-5)', () => {
    const html = render(
      {
        ...assemblySnapshot,
        hostActorId: viewer.actorId,
        teamOneSide: 'affirmative',
        definition: {
          ...assemblySnapshot.definition,
          sides: benches,
          seats: benchSeats,
        },
        rules: { ...assemblySnapshot.rules, sides: benches, seats: benchSeats },
        participants: [
          {
            ...(seated('v', 'affirmative', 0) as Extract<
              Participant,
              { actorId: string }
            >),
            seat: { kind: 'side', side: 'opening_government', slot: 0 },
          },
          {
            ...(seated('c', 'affirmative', 0) as Extract<
              Participant,
              { actorId: string }
            >),
            seat: { kind: 'side', side: 'closing_government', slot: 0 },
          },
        ],
      },
      [debaterBot],
    );
    const rowOf = (label: string) => {
      const start = html.indexOf(`<li aria-label="${label}"`);
      return html.slice(start, html.indexOf('</li>', start));
    };
    const own = rowOf('Member v');
    const closing = rowOf('Member c');
    const open = rowOf('Opening Opposition 1');
    assert({
      given:
        'a BP Room, the host on Opening Government, a member on Closing Government, Opening Opposition open',
      should:
        'lay each bench out as one compact row in the sides columns, tone each avatar by its bench, tag the host beside the name, and give icon Leave, icon Remove and Fill seat',
      actual: {
        compact: [own, closing, open].map(
          (row) =>
            row.includes('min-h-room-target') &&
            row.includes('room-roster-sides') &&
            !row.includes('room-roster-teams'),
        ),
        avatars: [own, closing].map(
          (row) => /size-roster-avatar[^"]*bg-hue-(\w+)-soft/.exec(row)?.[1],
        ),
        tags: own.includes('>You<') && own.includes('>Host<'),
        leave: own.includes('aria-label="Leave seat" title="Leave seat"'),
        remove: closing.includes('aria-label="Remove Member c" title="Remove"'),
        fill: open.includes('aria-label="Fill Opening Opposition 1"'),
        fillSeat: field(
          formOf(open, seatIntents.commandIds[1]!.assign),
          'seat',
        ),
      },
      expected: {
        compact: [true, true, true],
        avatars: ['sky', 'plum'],
        tags: true,
        leave: true,
        remove: true,
        fill: true,
        fillSeat: JSON.stringify({
          kind: 'side',
          side: 'opening_opposition',
          slot: 0,
        }).replaceAll('"', '&quot;'),
      },
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

describe('RoomRoster on the narrowest roster (SEAT-14)', () => {
  // The 360px container query lives in room.css; the markup must carry the
  // classes it acts on, and nothing beside the name may refuse to shrink.
  const rowOf = (html: string, label: string) => {
    const start = html.indexOf(`<li aria-label="${label}"`);
    return html.slice(start, html.indexOf('</li>', start));
  };
  const whoOf = (row: string) => ({
    avatar: /<span aria-hidden="true" class="([^"]*)"/.exec(row)?.[1] ?? '',
    rating: /<span class="([^"]*tabular-nums[^"]*)">\d/.exec(row)?.[1] ?? '',
    tags: [
      ...row.matchAll(/<span class="([^"]*bg-surface-sunken[^"]*)">/g),
    ].map((match) => match[1]!),
  });
  const narrow = (who: ReturnType<typeof whoOf>) => ({
    avatarSteps: who.avatar.split(' ').includes('room-roster-avatar'),
    ratingShrinks:
      who.rating.includes('truncate') && !who.rating.includes('shrink-0'),
    tagsShrink: who.tags.map(
      (tag) => tag.includes('truncate') && !tag.includes('shrink-0'),
    ),
  });

  test('a rated BP debater tagged You and Host', () => {
    const benches = [
      { key: 'opening_government', label: 'Opening Government', short: 'OG' },
      { key: 'opening_opposition', label: 'Opening Opposition', short: 'OO' },
      { key: 'closing_government', label: 'Closing Government', short: 'CG' },
      { key: 'closing_opposition', label: 'Closing Opposition', short: 'CO' },
    ];
    const seats = {
      sides: Object.fromEntries(benches.map((side) => [side.key, 1])),
      speakers: 0,
      judges: 0,
      moderators: 0 as const,
    };
    const html = render({
      ...assemblySnapshot,
      hostActorId: viewer.actorId,
      teamOneSide: 'affirmative',
      definition: { ...assemblySnapshot.definition, sides: benches, seats },
      rules: { ...assemblySnapshot.rules, sides: benches, seats },
      participants: [
        {
          ...(seated('v', 'affirmative', 0, {
            rating: { value: 1500, provisional: true },
          }) as Extract<Participant, { actorId: string }>),
          seat: { kind: 'side', side: 'opening_government', slot: 0 },
        },
      ],
    });
    const who = whoOf(rowOf(html, 'Member v'));
    assert({
      given: 'the host on Opening Government with a provisional rating',
      should:
        'let the avatar step aside on the tightest phones and let the rating and each tag truncate, keeping the bench tone',
      actual: {
        ...narrow(who),
        tone: who.avatar.includes('bg-hue-sky-soft'),
      },
      expected: {
        avatarSteps: true,
        ratingShrinks: true,
        tagsShrink: [true, true],
        tone: true,
      },
    });
  });

  test('a rated debater seated by the organiser in an event Room', () => {
    const html = render({
      ...sized(
        1,
        1,
        [
          seated('v', 'affirmative', 0, {
            rating: { value: 1620, provisional: false },
            eligible: false,
          }),
          seated('o', 'negative', 0),
        ],
        { teamOneSide: 'affirmative' },
      ),
      hostActorId: null,
      hostLabel: null,
      capabilities: { ...assemblySnapshot.capabilities, host: false },
    });
    const row = rowOf(html, 'Member v');
    assert({
      given: 'an event Room debater with a rating, tagged You and Not eligible',
      should:
        'still say who seated it while the avatar steps aside and the rating and tags truncate',
      actual: {
        ...narrow(whoOf(row)),
        note: html.includes('Seated by the organiser'),
      },
      expected: {
        avatarSteps: true,
        ratingShrinks: true,
        tagsShrink: [true, true],
        note: true,
      },
    });
  });
});

describe('RoomRoster header count (main-sync-4)', () => {
  const count = (html: string) =>
    html
      .match(/<p class="text-sm text-ink-muted tabular-nums">(.*?)<\/p>/)?.[1]
      ?.replaceAll('<!-- -->', '') ?? null;

  test('a two-sided Room with a judge', () => {
    const seats = seatsOf(1, 1, 1);
    const html = render({
      ...sized(1, 1, [seated('v', 'affirmative', 0)]),
      definition: { ...assemblySnapshot.definition, seats },
      rules: { ...assemblySnapshot.rules, seats },
    });
    assert({
      given: 'one of two debaters seated and the judge seat open',
      should: 'count debaters and judges apart',
      actual: count(html),
      expected: '1 of 2 debaters · 0 of 1 judge',
    });
  });

  test('a format with a moderator (TAB-6)', () => {
    const seats = {
      sides: {},
      speakers: 3,
      judges: 1,
      moderators: 1 as const,
    };
    const html = render({
      ...assemblySnapshot,
      definition: { ...assemblySnapshot.definition, sides: [], seats },
      rules: { ...assemblySnapshot.rules, sides: [], seats },
      participants: [
        {
          ...(seated('v', 'judge', 0) as Extract<
            Participant,
            { actorId: string }
          >),
          seat: { kind: 'moderator', slot: 0 },
        },
      ],
    });
    assert({
      given:
        'three open speaker seats, an open judge seat and a seated moderator',
      should: 'count the judge and the moderator together as officials',
      actual: count(html),
      expected: '0 of 3 debaters · 1 of 2 officials',
    });
  });
});

describe('RoomRoster lobbies (ADR 0162)', () => {
  const inLobby = (ageRule: RoomView['ageRule']): RoomView => {
    const seats = seatsOf(1, 1, 1);
    return {
      ...sized(1, 1, []),
      definition: { ...assemblySnapshot.definition, seats },
      rules: { ...assemblySnapshot.rules, seats },
      competitionType: 'ranked',
      ageRule,
    };
  };
  const takes = (html: string) =>
    (html.match(/>Take seat<\/button>/g) ?? []).length;

  test('debater seats are for the Room’s own lobby, judge seats for anyone (YLRoomSpectator)', () => {
    const own = render(inLobby('adults'));
    const other = render(inLobby('under-18'));
    assert({
      given:
        'an adult over an Open Room, then over a Youth Room, each with two debater seats and a judge seat open',
      should:
        'offer Take seat on all three at home, only on the judge seat across lobbies, and name no lobby',
      actual: [
        takes(own),
        takes(other),
        other.includes('aria-label="Take Judge'),
        other.includes('Youth') || other.includes('under 18'),
      ],
      expected: [3, 1, true, false],
    });
  });
});
