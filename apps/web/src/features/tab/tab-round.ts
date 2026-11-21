import type {
  TabRoundFixture,
  TabRoundHostView,
} from '@daisy/protocol/lobby/tab-round-read';
import { fixtureWords, roomStatusOf, type RoomStatus } from './at-scale-rooms';
import { linkTo, unavailableAction, type TabAction } from './action';
import type { EventSwitch } from './setup';

/** How much of the host's attention a Room wants, most first. */
export type RoomAttention =
  'needs_you' | 'waiting' | 'live' | 'judging' | 'finished';

export type AttentionRoom = {
  readonly status?: RoomStatus;
  readonly need?: 'overdue_ballot' | 'withdrawn_judge';
  readonly words?: readonly string[];
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type AttentionGroup = {
  readonly attention: RoomAttention;
  /** How many Rooms stand here, when the list shows only some of them. */
  readonly count: number | null;
  readonly rooms: readonly AttentionRoom[];
  readonly more: TabAction | null;
};

/** One published tab round of one event, with its Rooms by attention. */
export type RunningRound = {
  readonly event: EventSwitch;
  readonly title: string;
  readonly lede: string;
  readonly participantView: TabAction;
  readonly next: TabAction | null;
  readonly groups: readonly AttentionGroup[];
};

/** Renders an instant as the tournament's wall clock, such as "13:40". */
export type WallClock = (instant: string) => string;

const numberWords = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;
const ordinalWords = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
] as const;

/** A small count in words, such as "six"; a larger one in figures. */
export const countWord = (n: number): string => numberWords[n] ?? String(n);
const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};
const minutes = (ms: number) => {
  const whole = Math.round(ms / 60_000);
  return `${whole} ${whole === 1 ? 'minute' : 'minutes'}`;
};
const lateness = (behindByMs: number) =>
  behindByMs === 0 ? 'on time' : `running ${minutes(behindByMs)} late`;

const judgesOf = (judges: readonly { readonly name: string }[]) =>
  `${judges.length === 1 ? 'Judge' : 'Judges'} ${judges
    .map((judge) => judge.name)
    .join(' and ')}`;

const titleOf = (fixture: TabRoundFixture) =>
  fixture.kind === 'section'
    ? `Section ${fixture.label ?? ''}`
    : fixture.entries.map((entry) => entry.name).join(' v ');

const roomOf = (fixture: TabRoundFixture) => fixture.room?.name ?? 'No room';

const attentionRoom = (
  title: string,
  detail: string,
  action: TabAction,
): AttentionRoom => ({ title, detail, action });

const resultLine = (
  read: Pick<TabRoundHostView, 'capabilities' | 'byeCountsAs' | 'sectionSize'>,
  fixture: TabRoundFixture,
  result: Extract<TabRoundFixture['state'], { kind: 'finished' }>['result'],
) => {
  switch (result.kind) {
    case 'administrative':
      return result.reason === 'bye'
        ? `Bye · counted as ${read.byeCountsAs === 'win' ? 'a win' : "the entry's own average"} under the tournament's bye rule`
        : `${roomOf(fixture)} · ${result.reason.replace('_', ' ')}`;
    case 'decided': {
      const name = (entryId: string) =>
        fixture.entries.find((entry) => entry.entryId === entryId)?.name ?? '';
      if (fixture.kind === 'section') {
        const short =
          read.sectionSize !== null &&
          fixture.entries.length !== read.sectionSize
            ? [`${countWord(fixture.entries.length)} speakers`]
            : [];
        const placed = [...result.entries]
          .filter((entry) => entry.rank !== null)
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .slice(0, 3)
          .map((entry) => `${ordinal(entry.rank ?? 0)} ${name(entry.entryId)}`);
        return [
          roomOf(fixture),
          ...short,
          judgesOf(fixture.judges),
          ...placed,
        ].join(' · ');
      }
      const winner = result.entries.find((entry) => entry.won === true);
      const loser = result.entries.find((entry) => entry.won === false);
      return [
        roomOf(fixture),
        judgesOf(fixture.judges),
        winner === undefined || loser === undefined
          ? 'decided'
          : winner.points === null || loser.points === null
            ? `${name(winner.entryId)} won`
            : `${name(winner.entryId)} won ${winner.points} to ${loser.points}`,
        ...(result.corrected ? ['corrected'] : []),
      ].join(' · ');
    }
  }
};

/** One fixture as a row of the host's running round. */
const roundRoom = (
  read: Pick<TabRoundHostView, 'capabilities' | 'byeCountsAs' | 'sectionSize'>,
  fixture: TabRoundFixture,
): AttentionRoom => {
  const title = titleOf(fixture);
  const openRoom = unavailableAction('Open room');
  const { state } = fixture;
  switch (state.kind) {
    case 'waiting_for_start':
    case 'awaiting_result':
    case 'preparing':
      return attentionRoom(
        title,
        [
          roomOf(fixture),
          state.kind === 'waiting_for_start'
            ? 'Waiting for start'
            : state.kind === 'awaiting_result'
              ? 'Awaiting result'
              : 'Preparing',
        ].join(' · '),
        fixture.room
          ? linkTo('Open room', `/rooms/${fixture.room.roomId}`)
          : openRoom,
      );
    case 'ballot_overdue': {
      const spoken =
        state.speechesGiven === fixture.entries.length
          ? `all ${countWord(state.speechesGiven)} have spoken`
          : `${countWord(state.speechesGiven)} of ${countWord(fixture.entries.length)} have spoken`;
      return {
        ...attentionRoom(
          title,
          [
            ...(fixture.kind === 'section' ? [roomOf(fixture), spoken] : []),
            `Judge ${state.judge.name} has not opened the ballot`,
            `${minutes(state.overdueByMs)} overdue`,
          ].join(' · '),
          read.capabilities.officiate
            ? unavailableAction('Replace judge', true)
            : openRoom,
        ),
        need: 'overdue_ballot',
      };
    }
    case 'confirmation_requested':
      return attentionRoom(
        title,
        state.summary,
        state.canConfirm
          ? unavailableAction('Review and confirm', true)
          : openRoom,
      );
    case 'speaking':
      return attentionRoom(
        title,
        [
          roomOf(fixture),
          judgesOf(fixture.judges),
          state.speaker === null
            ? `${ordinalWords[state.segment] ?? ordinal(state.segment)} speech`
            : `${state.speaker} speaking, ${ordinal(state.segment)} of ${state.segmentCount}`,
        ].join(' · '),
        unavailableAction('Watch'),
      );
    case 'judging':
      return attentionRoom(
        title,
        [
          roomOf(fixture),
          judgesOf(fixture.judges),
          ...(state.ballotsDue === 1
            ? [
                state.openForMs === null
                  ? 'Awaiting ballot'
                  : `ballot open ${minutes(state.openForMs)}`,
              ]
            : [
                `${state.ballotsIn} of ${state.ballotsDue} ballots in`,
                ...(state.openForMs === null
                  ? []
                  : [`open ${minutes(state.openForMs)}`]),
              ]),
        ].join(' · '),
        openRoom,
      );
    case 'finished':
      return attentionRoom(
        title,
        resultLine(read, fixture, state.result),
        unavailableAction('Result'),
      );
  }
};

const attentionOf = (fixture: TabRoundFixture): RoomAttention => {
  if (fixture.judges.length === 0 && fixture.kind !== 'bye') return 'waiting';
  switch (fixture.state.kind) {
    case 'waiting_for_start':
    case 'awaiting_result':
    case 'preparing':
      return 'waiting';
    case 'ballot_overdue':
    case 'confirmation_requested':
      return 'needs_you';
    case 'speaking':
      return 'live';
    case 'judging':
      return 'judging';
    case 'finished':
      return 'finished';
  }
};

/** What the running round needs beside the read: the event picker and its addresses. */
export type RunningRoundContext = {
  readonly fixtureAction?: (fixture: TabRoundFixture) => TabAction;
  readonly overviewAction?: TabAction;
  readonly event: EventSwitch;
  readonly address: {
    readonly posting: string;
    readonly tournament: string;
    /** The next tab round's draw, where the host area has a page for it. */
    readonly nextDraw: string | null;
  };
  readonly wallClock: WallClock;
};

/** The host's running round: a projection of `TabRoundHostView`. */
export const runningRoundOf = (
  read: TabRoundHostView,
  context: RunningRoundContext,
): RunningRound => {
  const shown = (attention: RoomAttention): AttentionGroup[] => {
    const rooms = read.open
      .filter((fixture) => attentionOf(fixture) === attention)
      .map((fixture) => ({
        ...roundRoom(read, fixture),
        ...(context.fixtureAction
          ? { action: context.fixtureAction(fixture) }
          : {}),
        status: roomStatusOf(fixture),
        words: fixtureWords(fixture),
      }));
    return rooms.length === 0
      ? []
      : [{ attention, count: null, rooms, more: null }];
  };
  const { finished } = read;
  const unlisted = finished.total - finished.recent.length;
  const size =
    read.fixtureKind === 'section'
      ? [`${read.fixtureCount} sections`, `${read.entryCount} speakers`]
      : [`${read.fixtureCount} rooms`];
  const { tabRound, next } = read;
  return {
    event: context.event,
    title: tabRound.name ?? `Round ${tabRound.number}`,
    lede: [
      ...size,
      ...(read.startedAt === null
        ? [
            read.open.length > 0 &&
            read.open.every(
              (fixture) => fixture.state.kind === 'awaiting_result',
            )
              ? 'Awaiting results'
              : 'Waiting for start',
          ]
        : [`started ${context.wallClock(read.startedAt)}`]),
      read.progress.kind === 'running'
        ? read.progress.behindByMs === null
          ? ''
          : lateness(read.progress.behindByMs)
        : 'every ballot is in',
    ].join(' · '),
    participantView:
      context.overviewAction ??
      linkTo(
        'View as participant',
        read.postedToParticipants
          ? context.address.posting
          : context.address.tournament,
      ),
    next:
      next === null
        ? null
        : {
            ...(context.address.nextDraw === null
              ? { kind: 'unavailable' as const }
              : { kind: 'link' as const, href: context.address.nextDraw }),
            label:
              next.name === null
                ? `Open round ${next.number} draw`
                : `Open the ${next.name.toLowerCase()}'s draw`,
            primary: true,
          },
    groups: [
      ...shown('needs_you'),
      ...shown('waiting'),
      ...shown('live'),
      ...shown('judging'),
      {
        attention: 'finished',
        count: finished.total,
        rooms: finished.recent.map((fixture) => ({
          ...roundRoom(read, fixture),
          ...(context.fixtureAction
            ? { action: context.fixtureAction(fixture) }
            : {}),
          status: 'finished',
          words: fixtureWords(fixture),
        })),
        more: unlisted > 0 ? unavailableAction(`Show ${unlisted} more`) : null,
      },
    ],
  };
};

/** What the time slot needs beside the read: the event shown and the addresses. */
export type TimeSlotContext = {
  readonly selectedEventId: string | null;
  readonly address: {
    readonly slot: (eventId: string | null) => string;
    readonly tournament: string;
  };
  readonly wallClock: WallClock;
};
