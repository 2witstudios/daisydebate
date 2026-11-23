import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgeSeat, sideSeat } from '@daisy/protocol/seats';
import { type RoomView } from '@daisy/protocol/room-contract';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { idle } from '../../../features/forms/form-state';
import { botsForSeat, RoomRoster } from './room-roster';
import { seatIntents } from './seat-intents.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';

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
  renderAccessible(
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

type Fields = Readonly<Record<string, string>>;

/** The hidden fields a submit button posts with its form. */
const posted = (button: Element): Fields => {
  const form = (button as HTMLButtonElement).form;
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name]') ?? [])].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );
};
/** The fields posted by the button whose form carries command id `id`. */
const formOf = (view: AccessibleView, id: string): Fields | null =>
  view
    .all('button', undefined, { hidden: true })
    .map(posted)
    .find((fields) => fields.commandId === id) ?? null;
const field = (form: Fields | null, name: string) => form?.[name] ?? null;

/** A row's boxes, changeable (buttons) or not, in document order: "Member v's side: Neg". */
const boxes = (view: AccessibleView, kind: 'team' | 'side' | 'position') => {
  const named = new RegExp(`'s ${kind}: `);
  return [...view.all('button', named), ...view.all('generic', named)]
    .sort((a, b) =>
      // 4: DOCUMENT_POSITION_FOLLOWING, b after a.
      a.compareDocumentPosition(b) & 4 ? -1 : 1,
    )
    .map((box) => ({
      name: box.getAttribute('aria-label') ?? '',
      text: box.textContent ?? '',
    }));
};
/** The text of every paragraph, as read. */
const paragraphs = (view: AccessibleView) =>
  view.all('paragraph').map((p) => (p.textContent ?? '').trim());
/** The exact text of every unnamed span or box, for the tags beside a name. */
const tags = (view: AccessibleView) =>
  view.all('generic').map((element) => element.textContent ?? '');
/** Whether the host's Fill menu for `seat` offers `choice` to seat there. */
const offers = (view: AccessibleView, seat: string, choice: string) =>
  view.has('combobox', `Seat someone in ${seat}`) &&
  view.within('combobox', `Seat someone in ${seat}`).has('option', choice);

describe('RoomRoster columns', () => {
  test('a 1 v 1 Room', () => {
    const view = render(
      sized(1, 1, [seated('v', 'affirmative', 0), seated('o', 'negative', 0)]),
    );
    assert({
      given: 'one debater a side',
      should: 'show Side alone, both on ?',
      actual: {
        team: boxes(view, 'team').length > 0,
        position: boxes(view, 'position').length > 0,
        side: boxes(view, 'side').length > 0,
        open: boxes(view, 'side').filter((box) => box.text === '?').length,
      },
      expected: { team: false, position: false, side: true, open: 2 },
    });
  });

  test('a 2 v 2 Room', () => {
    const view = render(
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
        columns: (['team', 'side', 'position'] as const).map(
          (kind) => boxes(view, kind).length > 0,
        ),
        sides: boxes(view, 'side').map((box) => /side: .*/.exec(box.name)?.[0]),
        positions: boxes(view, 'position').map(
          (box) => /position: .*/.exec(box.name)?.[0],
        ),
        open: paragraphs(view).includes('Open'),
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
    const view = render(twoVsTwo, [], 'w'.repeat(24));
    const own = { ...twoVsTwo, hostActorId: 'h'.repeat(24) };
    const member = render(own, [], 'wa'.repeat(12));
    assert({
      given: 'a member who is not the host',
      should: 'let them change only their own row',
      actual: {
        team: field(formOf(member, 'team-1'), 'participantId'),
        others: [formOf(member, 'team-0'), formOf(member, 'team-3')],
        unknownViewer: formOf(view, 'team-1'),
      },
      expected: {
        team: 'w'.repeat(24),
        others: [null, null],
        unknownViewer: null,
      },
    });
  });

  test('the row action', () => {
    const view = render(twoVsTwo);
    const own = formOf(view, 'leave');
    assert({
      given: 'the host seated on team 1 beside two other debaters',
      should:
        'offer Leave seat on their own row and Remove on each other occupied row',
      actual: {
        leave: [field(own, 'type'), view.has('button', 'Leave seat')],
        remove: view.count('button', /^Remove /),
      },
      expected: { leave: ['leave-seat', true], remove: 2 },
    });
  });

  test('cycling a box', () => {
    const view = render(twoVsTwo);
    const team = formOf(view, 'team-0');
    const position = formOf(view, 'position-1');
    const sides = formOf(view, 'sides');
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
    const view = render(occupied);
    const own = view.within('listitem', 'Member v');
    assert({
      given:
        'two aff and three neg seats, a ready viewer with a provisional rating and an ineligible bot judge',
      should:
        'show all six seats, the real Ready marks, the rating inline and who each is',
      actual: {
        rows: view.count('listitem'),
        open: paragraphs(view).filter((text) => text === 'Open').length,
        ready: view.count('img', 'Ready'),
        rating: tags(own).includes('1500*'),
        you: tags(own).includes('You'),
        bot:
          tags(view.within('listitem', 'Judge bot')).includes('Bot') &&
          tags(view.within('listitem', 'Judge bot')).includes('Not eligible'),
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
    const view = render({
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
        tags(view.within('listitem', 'Judge 1')).includes('Judge'),
        view.count('img', 'Ready'),
        view.textContent().includes('undefined') ||
          view.names('listitem').some((name) => name.includes('undefined')),
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
    const hostJudge = host.within('listitem', 'Judge 1');
    const guestJudge = guest.within('listitem', 'Judge 1');
    assert({
      given: 'an open judge seat seen by the host and by a guest',
      should:
        'offer Take seat and Invite to both, and the AI judge and Seat picker to the host alone',
      actual: [
        hostJudge.has('button', 'Take Judge 1'),
        hostJudge.attribute('link', 'Invite', 'href'),
        field(ai, 'actorId'),
        field(ai, 'seat'),
        guestJudge.has('button', 'Take Judge 1'),
        guestJudge.has('link', 'Invite'),
        guest.textContent().includes('AI judge'),
        guest.textContent().includes('Seat…'),
      ],
      expected: [
        true,
        `/rooms/${assemblySnapshot.id}`,
        judgeBot.actorId,
        JSON.stringify(judgeSeat()),
        true,
        true,
        false,
        false,
      ],
    });
  });

  test('a casual host without the entitlement (WATCH-16)', () => {
    const view = render({ ...assemblySnapshot, aiJudgeSeating: 'premium' }, [
      judgeBot,
    ]);
    assert({
      given: 'an open judge seat seen by a casual host without the entitlement',
      should: 'offer a person, not the AI judge, and keep Invite',
      actual: [
        view.has('button', 'AI judge'),
        offers(view, 'Judge 1', 'Penny · Bot'),
        view.within('listitem', 'Judge 1').has('link', 'Invite'),
        view.textContent().includes('AI judging on casual Rounds is Premium'),
      ],
      expected: [false, false, true, true],
    });
  });

  test('bots offered only for the seats they may hold', () => {
    // Read each view before the next render: a label points at its control
    // by id, which only the current render's document resolves.
    const casualView = render(assemblySnapshot, [debaterBot]);
    const casual = [
      offers(casualView, 'Team 1 · 1st', 'Penny · Bot'),
      offers(casualView, 'Judge 1', 'Penny · Bot'),
      casualView.has('button', 'AI judge'),
    ];
    const ranked = render({ ...assemblySnapshot, competitionType: 'ranked' }, [
      debaterBot,
    ]);
    assert({
      given: 'a bot debater in the cast choices, casual then ranked',
      should:
        'offer it for debater seats in a casual Room only, never as the AI judge (ISSUE-750)',
      actual: [...casual, offers(ranked, 'Team 1 · 1st', 'Penny · Bot')],
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
        named: [
          host.textContent().includes('Invited: ana'),
          guest.textContent().includes('Invited: ana'),
        ],
        release: [
          host.has('button', 'Release') &&
            posted(host.get('button', 'Release')).invitationId ===
              'i'.repeat(24),
          guest.has('button', 'Release'),
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
    const rows = render({
      ...assemblySnapshot,
      participants: [],
      definition: { ...assemblySnapshot.definition, sides, seats },
      rules: { ...assemblySnapshot.rules, sides, seats },
    }).names('listitem');
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
    const view = render({
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
        boxes(view, 'team').length > 0,
        boxes(view, 'side').length > 0,
        boxes(view, 'position').length > 0,
        formOf(view, 'sides'),
      ],
      expected: [false, false, false, null],
    });
  });

  // The compact layout and the bench tones are classes only: see
  // markup-contracts/room-roster.test.tsx.
  test('a four-team (BP) row in the compact layout (main-sync-5)', () => {
    const view = render(
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
    const own = view.within('listitem', 'Member v');
    const closing = view.within('listitem', 'Member c');
    const open = view.within('listitem', 'Opening Opposition 1');
    assert({
      given:
        'a BP Room, the host on Opening Government, a member on Closing Government, Opening Opposition open',
      should:
        'tag the host beside the name, and give icon Leave, icon Remove and Fill seat',
      actual: {
        tags: tags(own).includes('You') && tags(own).includes('Host'),
        leave: own.attribute('button', 'Leave seat', 'title'),
        remove: closing.attribute('button', 'Remove Member c', 'title'),
        fill: open.has('button', 'Fill Opening Opposition 1'),
        fillSeat: field(
          formOf(open, seatIntents.commandIds[1]!.assign),
          'seat',
        ),
      },
      expected: {
        tags: true,
        leave: 'Leave seat',
        remove: 'Remove',
        fill: true,
        fillSeat: JSON.stringify({
          kind: 'side',
          side: 'opening_opposition',
          slot: 0,
        }),
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
    const view = render({
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
        (view.textContent().match(/Invited: ana/g) ?? []).length,
        view.has('button', 'Release'),
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
    const view = render(event);
    assert({
      given: 'a debater seated by the organiser in an event Room',
      should:
        'say who seated it, show their side by name and offer no way to change seat, side or position, or to leave',
      actual: {
        note: view.textContent().includes('Seated by the organiser'),
        side: view.has('generic', "Member v's side: Aff"),
        sides: formOf(view, 'sides'),
        team: formOf(view, 'team-0'),
        leave: view.has('button', 'Leave seat'),
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
    const view = render({
      ...event,
      participants: [seated('o', 'negative', 0)],
    });
    assert({
      given: 'an event Room seat the organiser has not filled yet',
      should: 'offer no Take seat and no Invite',
      actual: [
        view.textContent().includes('Take seat'),
        view.count('link', 'Invite') > 0,
      ],
      expected: [false, false],
    });
  });
});

// The narrowest roster (SEAT-14) is carried by classes only: see
// markup-contracts/room-roster.test.tsx.

describe('RoomRoster header count (main-sync-4)', () => {
  const count = (view: AccessibleView) =>
    paragraphs(view.within('region', 'Players')).find((text) =>
      / of \d+ debaters?\b/.test(text),
    ) ?? null;

  test('a two-sided Room with a judge', () => {
    const seats = seatsOf(1, 1, 1);
    const view = render({
      ...sized(1, 1, [seated('v', 'affirmative', 0)]),
      definition: { ...assemblySnapshot.definition, seats },
      rules: { ...assemblySnapshot.rules, seats },
    });
    assert({
      given: 'one of two debaters seated and the judge seat open',
      should: 'count debaters and judges apart',
      actual: count(view),
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
    const view = render({
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
      actual: count(view),
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
  const takes = (view: AccessibleView) => view.count('button', /^Take /);

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
        other.count('button', /^Take Judge/) > 0,
        other.textContent().includes('Youth') ||
          other.textContent().includes('under 18'),
      ],
      expected: [3, 1, true, false],
    });
  });
});
