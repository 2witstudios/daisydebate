import type {
  PostedFixture,
  PostedJudge,
  PostingView,
  ShownEntrant,
} from '@daisy/protocol/lobby/posting-read';
import type { DayRow, DayView } from '@daisy/protocol/lobby/day-read';
import type { TabRoundRef } from '@daisy/protocol/lobby/lobby-read';

type DayFixture = NonNullable<DayRow['fixture']>;

/**
 * A sample id: the same 24 lowercase characters for the same key, so the
 * sample's records can name each other the way stored ids do.
 */
export function sampleId(key: string): string {
  let out = '';
  for (let round = 0; out.length < 24; round += 1) {
    let hash = 0x811c9dc5 ^ round;
    for (const char of key) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(36).padStart(7, '0');
  }
  return out.slice(0, 24);
}

/** An instant on the sample's calendar, in UTC. */
export const at = (day: string, time: string): string =>
  `${day}T${time}:00.000Z`;

export const named = (name: string): ShownEntrant => ({ kind: 'name', name });
export const initials = (text: string): ShownEntrant => ({
  kind: 'initials',
  initials: text,
});
export const judge = (name: string, chair = false): PostedJudge => ({
  name,
  chair,
});

export const tabRound = (
  lobby: string,
  event: string,
  number: number,
  name: string | null = null,
  stage: TabRoundRef['stage'] = 'preliminary',
): TabRoundRef => ({
  tabRoundId: sampleId(`${lobby}/${event}/round-${number}`),
  eventId: sampleId(`${lobby}/${event}`),
  number,
  name,
  stage,
});

/** One published fixture with a Room, its entrants in position order. */
export const postedFixture = (
  room: string,
  roomName: string,
  entrants: readonly ShownEntrant[],
  judges: readonly PostedJudge[],
  video = true,
): PostedFixture => ({
  fixtureId: sampleId(`fixture/${room}`),
  kind: 'pairing',
  room: { roomId: sampleId(room), name: roomName },
  entries: entrants.map((shown) => ({
    entryId: sampleId(`entry/${shownKey(shown)}`),
    shown,
  })),
  judges: [...judges],
  video,
});

const shownKey = (shown: ShownEntrant) =>
  shown.kind === 'name' ? shown.name : shown.initials;

/** `Jensen v Amari` as a fixture's two named entrants. */
export const versus = (title: string): readonly ShownEntrant[] =>
  title.split(/ v |, /).map(named);

export const postingOf = (
  lobby: string,
  event: { readonly key: string; readonly name: string },
  round: TabRoundRef,
  times: { readonly opensAt: string; readonly startedAt: string | null },
  roomCount: number,
  fixtures: readonly PostedFixture[],
  more: number,
): PostingView => ({
  lobbyId: sampleId(lobby),
  event: { eventId: sampleId(`${lobby}/${event.key}`), name: event.name },
  tabRound: round,
  opensAt: times.opensAt,
  startedAt: times.startedAt,
  roomCount,
  fixtures: [...fixtures],
  more,
  resolution: null,
});

type DayRowInput = Omit<
  DayRow,
  'tabRound' | 'event' | 'breaking' | 'recording' | 'result' | 'person'
> &
  Partial<Pick<DayRow, 'breaking' | 'recording' | 'result' | 'person'>>;

/** One row of a person's day, in one event's tab round. */
export const dayRow = (
  lobby: string,
  event: { readonly key: string; readonly name: string },
  round: {
    readonly number: number;
    readonly name?: string | null;
    readonly stage?: TabRoundRef['stage'];
  },
  row: DayRowInput,
): DayRow => ({
  person: { kind: 'self' },
  breaking: null,
  result: null,
  recording: null,
  ...row,
  event: { eventId: sampleId(`${lobby}/${event.key}`), name: event.name },
  tabRound: tabRound(
    lobby,
    event.key,
    round.number,
    round.name ?? null,
    round.stage ?? 'preliminary',
  ),
});

/** A fixture as a day row shows it: the row's own entry marked. */
export const dayFixture = (
  room: string,
  roomName: string,
  entrants: readonly {
    readonly name: string;
    readonly side?: string;
    readonly own?: boolean;
  }[],
  judges: readonly PostedJudge[],
  extra: Partial<Pick<DayFixture, 'kind' | 'speaks' | 'topicAt'>> = {},
): DayFixture => ({
  fixtureId: sampleId(`fixture/${room}`),
  kind: 'pairing',
  room: { roomId: sampleId(room), name: roomName },
  entries: entrants.map((entrant) => ({
    entryId: sampleId(`entry/${entrant.name}`),
    shown: named(entrant.name),
    side: entrant.side ?? null,
    own: entrant.own ?? false,
  })),
  judges: [...judges],
  speaks: null,
  topicAt: null,
  ...extra,
});

export const won = (
  judgesFor = 1,
  judgesAgainst = 0,
  points: number | null = null,
): DayRow['result'] => ({
  kind: 'released',
  decision: { kind: 'debate', won: true, judgesFor, judgesAgainst },
  scores: points === null ? null : { points },
});
export const lost = (
  judgesFor = 0,
  judgesAgainst = 1,
  points: number | null = null,
): DayRow['result'] => ({
  kind: 'released',
  decision: { kind: 'debate', won: false, judgesFor, judgesAgainst },
  scores: points === null ? null : { points },
});
export const over = { kind: 'over' } as const;

/** One time slot of a day, holding the rows the viewer has in it. */
export const daySlot = (
  lobby: string,
  name: string,
  startsAt: string,
  rows: readonly DayRow[],
) => ({
  timeSlotId: sampleId(`${lobby}/slot/${startsAt}`),
  name,
  startsAt,
  rows: [...rows],
});

/** A day: its slots in order, leaving out a slot with no rows. */
export const dayOf = (
  lobby: string,
  asOf: string,
  slots: readonly ReturnType<typeof daySlot>[],
): DayView => ({
  lobbyId: sampleId(lobby),
  asOf,
  slots: slots.filter((slot) => slot.rows.length > 0),
});
