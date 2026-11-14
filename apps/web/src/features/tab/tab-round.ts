import type {
  TabRoundFixture,
  TabRoundHostView,
  TimeSlotConcern,
  TimeSlotHostView,
} from '@daisy/protocol/lobby/tab-round-read';
import { linkTo, sampleAction, type TabAction } from './action';
import { sampleTabRoundView, sampleTimeSlotView } from './sample/tab-round';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

/** How much of the host's attention a Room wants, most first. */
export type RoomAttention =
  'needs_you' | 'waiting' | 'live' | 'judging' | 'finished';

export type AttentionRoom = {
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

export type SlotEvent = {
  readonly slug: string;
  readonly name: string;
  readonly note: string | null;
  readonly detail: string;
  readonly rooms: TabAction;
};

/** One time slot across every event that shares it. */
export type TimeSlot = {
  readonly title: string;
  readonly lede: string;
  readonly participantView: TabAction;
  readonly tabs: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly needsYou: readonly AttentionRoom[];
  readonly events: readonly SlotEvent[];
  readonly next: {
    readonly heading: string;
    readonly items: readonly AttentionRoom[];
  } | null;
};

/** Renders an instant as the tournament's wall clock, such as "13:40". */
export type WallClock = (instant: string) => string;

const numberWords = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
] as const;
const ordinalWords = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth',
] as const;

/** A small count in words, such as "six"; a larger one in figures. */
export const countWord = (n: number): string => numberWords[n] ?? String(n);
const capitalized = (word: string) =>
  `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
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

const resultLine = (read: TabRoundHostView, fixture: TabRoundFixture, result: Extract<TabRoundFixture['state'], { kind: 'finished' }>['result']) => {
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
          read.sectionSize !== null && fixture.entries.length !== read.sectionSize
            ? [`${countWord(fixture.entries.length)} speakers`]
            : [];
        const placed = [...result.entries]
          .filter((entry) => entry.rank !== null)
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .slice(0, 3)
          .map((entry) => `${ordinal(entry.rank ?? 0)} ${name(entry.entryId)}`);
        return [roomOf(fixture), ...short, judgesOf(fixture.judges), ...placed].join(' · ');
      }
      const winner = result.entries.find((entry) => entry.won === true);
      const loser = result.entries.find((entry) => entry.won === false);
      return [
        roomOf(fixture),
        judgesOf(fixture.judges),
        winner === undefined || loser === undefined
          ? 'decided'
          : `${name(winner.entryId)} won ${winner.points ?? ''} to ${loser.points ?? ''}`,
        ...(result.corrected ? ['corrected'] : []),
      ].join(' · ');
    }
  }
};

/** One fixture as a row of the host's running round. */
const roundRoom = (
  read: TabRoundHostView,
  fixture: TabRoundFixture,
): AttentionRoom => {
  const title = titleOf(fixture);
  const openRoom = sampleAction('Open room');
  const { state } = fixture;
  switch (state.kind) {
    case 'ballot_overdue': {
      const spoken =
        state.speechesGiven === fixture.entries.length
          ? `all ${countWord(state.speechesGiven)} have spoken`
          : `${countWord(state.speechesGiven)} of ${countWord(fixture.entries.length)} have spoken`;
      return attentionRoom(
        title,
        [
          ...(fixture.kind === 'section' ? [roomOf(fixture), spoken] : []),
          `Judge ${state.judge.name} has not opened the ballot`,
          `${minutes(state.overdueByMs)} overdue`,
        ].join(' · '),
        read.capabilities.officiate
          ? sampleAction('Replace judge', true)
          : openRoom,
      );
    }
    case 'confirmation_requested':
      return attentionRoom(
        title,
        state.summary,
        state.canConfirm ? sampleAction('Review and confirm', true) : openRoom,
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
        sampleAction('Watch'),
      );
    case 'judging':
      return attentionRoom(
        title,
        [
          roomOf(fixture),
          judgesOf(fixture.judges),
          ...(state.ballotsDue === 1
            ? [`ballot open ${minutes(state.openForMs)}`]
            : [
                `${state.ballotsIn} of ${state.ballotsDue} ballots in`,
                `open ${minutes(state.openForMs)}`,
              ]),
        ].join(' · '),
        openRoom,
      );
    case 'finished':
      return attentionRoom(
        title,
        resultLine(read, fixture, state.result),
        sampleAction('Result'),
      );
  }
};

const attentionOf = (fixture: TabRoundFixture): RoomAttention => {
  switch (fixture.state.kind) {
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
      .map((fixture) => roundRoom(read, fixture));
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
      `started ${context.wallClock(read.startedAt)}`,
      read.progress.kind === 'running'
        ? lateness(read.progress.behindByMs)
        : 'every ballot is in',
    ].join(' · '),
    participantView: linkTo(
      'View as participant',
      read.postedToParticipants
        ? context.address.posting
        : context.address.tournament,
    ),
    next:
      next === null
        ? null
        : {
            label:
              next.name === null
                ? `Open round ${next.number} draw`
                : `Open the ${next.name.toLowerCase()}'s draw`,
            href: context.address.nextDraw,
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
        rooms: finished.recent.map((fixture) => roundRoom(read, fixture)),
        more: unlisted > 0 ? sampleAction(`Show ${unlisted} more`) : null,
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

const surname = (name: string) => name.split(' ').at(-1) ?? name;
const listed = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

const concernRoom = (
  read: TimeSlotHostView,
  concern: TimeSlotConcern,
  wallClock: WallClock,
): AttentionRoom => {
  const event =
    read.events.find((candidate) => candidate.eventId === concern.eventId)
      ?.name ?? '';
  const { officiate, editDraw } = read.capabilities;
  switch (concern.kind) {
    case 'judge_held_elsewhere': {
      const { elsewhere } = concern;
      const section = elsewhere.fixtureKind === 'section';
      return attentionRoom(
        `${event} · ${concern.entries.map((entry) => entry.name).join(' v ')}`,
        `Judge ${concern.judge.name} hasn't finished ${section ? 'ranking' : 'judging'} ${elsewhere.eventName} ${section ? `section ${elsewhere.fixtureLabel}` : elsewhere.fixtureLabel} from the ${wallClock(elsewhere.timeSlotStartsAt)} slot, so this room can't start.`,
        officiate ? sampleAction('Swap judge', true) : sampleAction('Open room'),
      );
    }
    case 'judge_withdrawn': {
      const format =
        read.events.find((candidate) => candidate.eventId === concern.eventId)
          ?.formatName ?? '';
      const { replacement } = concern;
      return attentionRoom(
        `${event} · ${concern.room.name}`,
        replacement === null
          ? `Judge ${concern.judge.name} dropped out. No free judge in this slot is cleared for ${format}.`
          : `Judge ${concern.judge.name} dropped out. ${replacement.name} is free in this slot, has no conflict here and is cleared for ${format}.`,
        officiate
          ? sampleAction(
              replacement === null ? 'Swap judge' : `Assign ${surname(replacement.name)}`,
              true,
            )
          : sampleAction('Open room'),
      );
    }
    case 'draw_ready':
      return attentionRoom(
        `${event} · round ${concern.tabRoundNumber} draft is ready`,
        `All ${concern.ballotsIn} ballots are in. Round ${concern.tabRoundNumber} can be published now${
          concern.publishWithOthersAt === null
            ? ''
            : ` or held until ${wallClock(concern.publishWithOthersAt)} with the other events`
        }.`,
        sampleAction(editDraw ? 'Review draw' : 'Open draw', editDraw),
      );
  }
};

const eventDetail = (
  event: TimeSlotHostView['events'][number],
  wallClock: WallClock,
): string => {
  const { fixtures, resolution } = event;
  const preparing = fixtures.preparing === 0 ? [] : [`${fixtures.preparing} preparing`];
  const counts = [
    ...(resolution === null ? preparing : []),
    ...(fixtures.ballotsIn === 0 ? [] : [`${fixtures.ballotsIn} ballots in`]),
    ...(fixtures.live === 0 ? [] : [`${fixtures.live} live`]),
    ...(fixtures.judging === 0 ? [] : [`${fixtures.judging} judging`]),
    ...(fixtures.waitingForJudge === 0
      ? []
      : [`${fixtures.waitingForJudge} waiting for a judge`]),
  ];
  return [
    `${event.roomCount} rooms`,
    ...(resolution === null
      ? []
      : [
          `resolution struck at ${wallClock(resolution.releasedAt)}`,
          ...preparing.map(
            (line) => `${line}, speeches begin ${wallClock(resolution.speechesBeginAt)}`,
          ),
        ]),
    ...(fixtures.ballotsIn === event.roomCount
      ? ['all ballots in']
      : counts.length === 0
        ? []
        : [counts.join(', ')]),
  ].join(' · ');
};

/** A time slot across its events: a projection of `TimeSlotHostView`. */
export const timeSlotOf = (
  read: TimeSlotHostView,
  context: TimeSlotContext,
): TimeSlot => {
  const { selectedEventId, address, wallClock } = context;
  const inView = (eventId: string) =>
    selectedEventId === null || eventId === selectedEventId;
  const rooms = read.events.reduce((sum, event) => sum + event.roomCount, 0);
  const kinds = new Set(read.events.map((event) => event.fixtureKind));
  const roomsHere =
    kinds.size === 1 ? (kinds.has('section') ? 'speech rooms' : 'debate rooms') : 'rooms';
  const { next } = read;
  return {
    title: read.timeSlot.name,
    lede: [
      wallClock(read.timeSlot.startsAt),
      `${countWord(read.events.length)} events`,
      `${rooms} rooms`,
      lateness(read.behindByMs ?? 0),
    ].join(' · '),
    participantView: linkTo('View as participant', address.tournament),
    tabs: [
      {
        id: 'all',
        label: 'All events',
        href: address.slot(null),
        selected: selectedEventId === null,
      },
      ...read.events.map((event) => ({
        id: event.eventId,
        label: event.name,
        href: address.slot(event.eventId),
        selected: event.eventId === selectedEventId,
      })),
    ],
    needsYou: read.concerns
      .filter((concern) => inView(concern.eventId))
      .map((concern) => concernRoom(read, concern, wallClock)),
    events: read.events
      .filter((event) => inView(event.eventId))
      .map((event) => ({
        slug: event.eventId,
        name: event.name,
        note:
          event.separateBreaks.length === 0
            ? null
            : `one pool, ${listed(event.separateBreaks.map((label) => label.toLowerCase()))} break separately`,
        detail: eventDetail(event, wallClock),
        rooms: sampleAction('Rooms'),
      })),
    next:
      selectedEventId !== null || next === null
        ? null
        : {
            heading: `Next · ${next.name} at ${wallClock(next.startsAt)}`,
            items:
              next.drawnEvents.length === 0
                ? []
                : [
                    attentionRoom(
                      `${listed(next.drawnEvents.map((event) => event.name))} ${
                        next.drawnEvents.every((event) => event.fixtureKind === 'section')
                          ? 'sections are'
                          : 'draws are'
                      } drawn`,
                      `${next.fixtureCount} ${
                        next.drawnEvents.every((event) => event.fixtureKind === 'section')
                          ? 'sections'
                          : 'rooms'
                      }. ${capitalized(countWord(next.judgesSeatedHere))} of their judges are in ${roomsHere} now; ${
                        next.judgesRunningLate === 0
                          ? `all ${countWord(next.judgesSeatedHere)} are on time so far`
                          : `${countWord(next.judgesRunningLate)} running late`
                      }.`,
                      sampleAction('See judges'),
                    ),
                  ],
          },
  };
};

export const readRunningRound = (
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): RunningRound | null => {
  const sample = sampleTabRoundView(slug, event, round, scene);
  return sample === null ? null : runningRoundOf(sample.read, sample.context);
};

export const readTimeSlot = (
  slug: string,
  slot: string,
  event: string | null,
  scene: SampleScene,
): TimeSlot | null => {
  const sample = sampleTimeSlotView(slug, slot, scene);
  if (sample === null) return null;
  const selectedEventId = sample.eventIdOf(event);
  if (event !== null && selectedEventId === null) return null;
  return timeSlotOf(sample.read, { ...sample.context, selectedEventId });
};
