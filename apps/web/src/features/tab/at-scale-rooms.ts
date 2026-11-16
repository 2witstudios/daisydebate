import type {
  DrawFindingSeverity,
  DrawView,
  DrawViewFixture,
} from '@daisy/protocol/lobby/draw-read';
import type {
  TabRoundFixture,
  TimeSlotConcern,
} from '@daisy/protocol/lobby/tab-round-read';
import type { RowFacets } from './at-scale';

/** At scale, a round's rooms and a draw's fixtures: their statuses, search words and what merges. */
/** The status filter of a round's rooms, as the host scans them. */
export const roomStatuses = ['waiting', 'live', 'judging', 'finished'] as const;
export type RoomStatus = (typeof roomStatuses)[number];

export const roomStatusLabels: Readonly<Record<RoomStatus, string>> = {
  waiting: 'Waiting',
  live: 'Live',
  judging: 'Judging',
  finished: 'Finished',
};

/** Where a fixture of a running round stands for the status filter. */
export function roomStatusOf(fixture: TabRoundFixture): RoomStatus {
  if (fixture.judges.length === 0 && fixture.kind !== 'bye') return 'waiting';
  switch (fixture.state.kind) {
    case 'waiting_for_start':
    case 'awaiting_result':
    case 'preparing':
      return 'waiting';
    case 'speaking':
    case 'confirmation_requested':
      return 'live';
    case 'judging':
    case 'ballot_overdue':
      return 'judging';
    case 'finished':
      return 'finished';
  }
}

/** The words a fixture is found by: its entries, its room and its judges. */
export const fixtureWords = (fixture: TabRoundFixture): readonly string[] => [
  ...fixture.entries.map((entry) => entry.name),
  ...(fixture.room === null ? [] : [fixture.room.name]),
  ...fixture.judges.map((judge) => judge.name),
  ...(fixture.label === null ? [] : [fixture.label]),
];

/** A running round's fixtures, searched and sorted into statuses. */
export const fixtureFacets: RowFacets<TabRoundFixture, RoomStatus> = {
  textOf: fixtureWords,
  statusOf: roomStatusOf,
};

/**
 * What makes two of the host's concerns alike: overdue ballots merge into
 * one row, as do judges withdrawn with nobody offered in their place. A
 * concern the host settles one by one merges with nothing.
 */
export function needKeyOf(
  item: TabRoundFixture | TimeSlotConcern,
): string | null {
  if ('state' in item)
    return item.state.kind === 'ballot_overdue' ? 'ballot_overdue' : null;
  return item.kind === 'judge_withdrawn' && item.replacement === null
    ? 'judge_withdrawn'
    : null;
}

/** A finding that asks the host to look: a broken rule first, then a bent preference, then a note. */
const findingWeight: Readonly<Record<DrawFindingSeverity, number>> = {
  rule_broken: 0,
  preference_bent: 1,
  note: 2,
};

/**
 * A large draft draw: the fixtures with a finding to look at first (worst
 * first, then in draw order), and each record group's fixtures without one.
 */
export function drawAtScale(read: DrawView): {
  readonly lookFirst: readonly DrawViewFixture[];
  readonly groups: readonly {
    readonly record: DrawView['recordGroups'][number]['record'];
    readonly fixtures: readonly DrawViewFixture[];
    /** The group's fixtures listed under Look first instead. */
    readonly listedAbove: number;
    readonly total: number;
  }[];
} {
  const weight = (fixture: DrawViewFixture) =>
    Math.min(
      ...fixture.findings.map((finding) => findingWeight[finding.severity]),
    );
  const all = read.recordGroups.flatMap((group) => group.fixtures);
  return {
    lookFirst: all
      .filter((fixture) => fixture.findings.length > 0)
      .map((fixture, place) => ({ fixture, place }))
      .sort(
        (a, b) => weight(a.fixture) - weight(b.fixture) || a.place - b.place,
      )
      .map(({ fixture }) => fixture),
    groups: read.recordGroups.map((group) => {
      const plain = group.fixtures.filter(
        (fixture) => fixture.findings.length === 0,
      );
      return {
        record: group.record,
        fixtures: plain,
        listedAbove: group.fixtures.length - plain.length,
        total: group.fixtures.length,
      };
    }),
  };
}
