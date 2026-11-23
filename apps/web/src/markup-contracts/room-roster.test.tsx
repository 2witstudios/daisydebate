import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgeSeat, sideSeat } from '@daisy/protocol/seats';
import { type RoomView } from '@daisy/protocol/room-contract';
import { assemblySnapshot } from '../features/rooms/assembly.test-support';
import { idle } from '../features/forms/form-state';
import { RoomRoster } from '../ui/rooms/room-page/room-roster';
import { seatIntents } from '../ui/rooms/room-page/seat-intents.test-support';
import { renderMarkup } from '../test-support/rendered/markup';

setupRitewayBun();

// Markup contract: the roster's grid columns, bench tones, rating style and
// narrow-phone truncation are carried by classes and by an aria-hidden column
// header only, with no accessible equivalent to assert. The roster's roles,
// names and posted fields are tested in ui/rooms/room-page/room-roster.test.tsx.

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
  renderMarkup(
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

describe('RoomRoster column header', () => {
  const header = (html: string) =>
    /<div aria-hidden="true" class="grid[^"]*">(.*?)<\/div>/.exec(html)?.[1] ??
    '';
  test('a 1 v 1 Room', () => {
    const html = header(
      render(
        sized(1, 1, [
          seated('v', 'affirmative', 0),
          seated('o', 'negative', 0),
        ]),
      ),
    );
    assert({
      given: 'one debater a side',
      should: 'head the boxes with Side alone',
      actual: ['>Team<', '>Side<', '>Position<'].map((c) => html.includes(c)),
      expected: [false, true, false],
    });
  });

  test('a 2 v 2 Room', () => {
    const html = header(render(sized(2, 2, [seated('v', 'affirmative', 0)])));
    assert({
      given: 'two seats a side',
      should: 'head the boxes with Team, Side and Position',
      actual: ['>Team<', '>Side<', '>Position<'].map((c) => html.includes(c)),
      expected: [true, true, true],
    });
  });
});

test('a provisional rating is set in italics', () => {
  const html = render({
    ...assemblySnapshot,
    participants: [
      seated('v', 'affirmative', 1, {
        ready: 'ready',
        rating: { value: 1500, provisional: true },
      }),
    ],
  });
  assert({
    given: 'a viewer with a provisional rating',
    should: 'show the rating inline, in italics',
    actual: /class="[^"]*italic[^"]*">1500\*</.test(html),
    expected: true,
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
        'lay each bench out as one compact row in the sides columns and tone each avatar by its bench',
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
      },
      expected: {
        compact: [true, true, true],
        avatars: ['sky', 'plum'],
      },
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
