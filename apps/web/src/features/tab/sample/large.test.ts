import { drawViewSchema } from '@daisy/protocol/lobby/draw-read';
import {
  entryListViewSchema,
  judgeListViewSchema,
} from '@daisy/protocol/lobby/entry-read';
import { eventResultsViewSchema } from '@daisy/protocol/lobby/results-read';
import {
  bracketViewSchema,
  standingsViewSchema,
} from '@daisy/protocol/lobby/standings-read';
import {
  tabRoundHostViewSchema,
  timeSlotHostViewSchema,
} from '@daisy/protocol/lobby/tab-round-read';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { breakTables, clearByWinOrPoints } from '../at-scale-tables';
import { readDrawBoard } from './read-draw';
import { standingsTableOf } from '../standings';
import { sampleDrawView } from './draw';
import { sampleEntryList, sampleJudgeList } from './entries';
import { largeSurname } from './large-names';
import { sampleBracketView, sampleEventResultsView } from './results';
import type { SampleScene } from './scene';
import { sampleDivisionStandingsView, sampleStandingsView } from './standings';
import { sampleTabRoundView, sampleTimeSlotView } from './tab-round';

setupRitewayBun();

const scene = (
  moment: SampleScene['moment'],
  scale: SampleScene['scale'] = 'large',
  viewer: SampleScene['viewer'] = 'host',
): SampleScene => ({ viewer, moment, scale });
const AUTUMN = 'autumn-open';
const VARSITY = 'varsity-debate';

const valid = (
  schema: { safeParse: (v: unknown) => { success: boolean } },
  read: unknown,
) => schema.safeParse(read).success;
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

describe('the large sample tournament', () => {
  test('its names never repeat', () => {
    const names = Array.from({ length: 400 }, (_, n) => largeSurname(n));
    assert({
      given: 'the first 400 generated surnames',
      should: 'be 400 different names, the ordinary sample’s first',
      actual: [new Set(names).size, names.slice(0, 3)],
      expected: [400, ['Jensen', 'Castillo', 'Okafor']],
    });
  });

  test('the host reads grow and keep their shapes', () => {
    const round = sampleTabRoundView(AUTUMN, VARSITY, '3', scene('prelims'));
    const slot = sampleTimeSlotView('winter-classic', '1200', scene('prelims'));
    const draw = sampleDrawView(AUTUMN, VARSITY, '4', scene('prelims'));
    const fixtures = draw?.read.recordGroups.flatMap((g) => g.fixtures) ?? [];
    const standings = sampleStandingsView(AUTUMN, null, scene('break'));
    const novice = sampleDivisionStandingsView(
      AUTUMN,
      null,
      'Novice',
      scene('break'),
    );
    const bracket = sampleBracketView(AUTUMN, null, scene('elims'));
    const results = sampleEventResultsView(AUTUMN, scene('elims'));
    const entries = sampleEntryList(AUTUMN, scene('before'));
    const judges = sampleJudgeList(AUTUMN, scene('prelims'));
    const schools = entries?.groups.filter(
      (group) => group.responsible.kind === 'school',
    );
    assert({
      given: 'each host read of the large sample',
      should: 'parse under its contract and hold the tournament at scale',
      actual: {
        valid: [
          valid(tabRoundHostViewSchema, round?.read),
          valid(timeSlotHostViewSchema, slot?.read),
          valid(drawViewSchema, draw?.read),
          valid(standingsViewSchema, standings?.read),
          valid(standingsViewSchema, novice?.read),
          valid(bracketViewSchema, bracket?.read),
          valid(eventResultsViewSchema, results?.read),
          valid(entryListViewSchema, entries),
          valid(judgeListViewSchema, judges),
        ],
        round: [
          round?.read.fixtureCount,
          (round?.read.open.length ?? 0) + (round?.read.finished.total ?? 0),
          unique(round?.read.open.map((f) => f.fixtureId) ?? []),
        ],
        slotRooms: slot?.read.events.reduce((sum, e) => sum + e.roomCount, 0),
        draw: [fixtures.length, unique(fixtures.map((f) => f.fixtureId))],
        standings: [standings?.read.rows.length, novice?.read.rows.length],
        bracket: bracket?.read.tabRounds[0]?.fixtures.length,
        schools: schools?.length,
        entries: [
          entries?.groups.every((g) => g.entries.length === g.entryCount),
          entries?.counts.pending,
          unique(
            entries?.groups.flatMap((g) => g.entries.map((e) => e.id)) ?? [],
          ),
        ],
        judges: [
          judges?.counts.judges,
          unique(
            judges?.groups.flatMap((g) => g.judges.map((j) => j.id)) ?? [],
          ),
        ],
      },
      expected: {
        valid: [true, true, true, true, true, true, true, true, true],
        round: [100, 100, true],
        slotRooms: 120,
        draw: [100, true],
        standings: [200, 60],
        bracket: 32,
        schools: 60,
        entries: [true, 26, true],
        judges: [150, true],
      },
    });
  });

  test('the ordinary sample is unchanged', () => {
    const normal = scene('prelims', 'normal');
    assert({
      given: 'the same reads at the ordinary size',
      should: 'answer as the canvas draws them',
      actual: [
        sampleTabRoundView(AUTUMN, VARSITY, '3', normal)?.read.open.length,
        sampleDrawView(AUTUMN, VARSITY, '4', normal)?.read.recordGroups.length,
        sampleStandingsView(AUTUMN, null, normal)?.read.rows.length,
        sampleDivisionStandingsView(AUTUMN, null, 'Novice', normal),
        sampleEntryList(AUTUMN, normal)?.groupsNotShown,
        sampleJudgeList(AUTUMN, normal)?.counts.judges,
      ],
      expected: [4, 3, 10, null, 5, 12],
    });
  });

  test('the ordinary draw addresses still lead somewhere at scale', () => {
    const board = readDrawBoard(
      AUTUMN,
      VARSITY,
      '4',
      'doyle-sato',
      scene('prelims'),
    );
    const generated = board?.groups[1]?.fixtures.at(-1);
    const slug = generated?.href.split('fixture=').at(-1) ?? '';
    assert({
      given:
        'the large draft opened at Doyle v Sato, and at a generated fixture',
      should: 'select each fixture by its address',
      actual: [
        board?.selected?.title,
        readDrawBoard(AUTUMN, VARSITY, '4', slug, scene('prelims'))?.selected
          ?.title,
      ],
      expected: ['Doyle v Sato', generated?.title],
    });
  });

  test('the standings split into a main and a novice break', () => {
    const whole = sampleStandingsView(AUTUMN, null, scene('break'));
    const novice = sampleDivisionStandingsView(
      AUTUMN,
      null,
      'Novice',
      scene('break'),
    );
    const table = (read: typeof whole) =>
      read === null ? [] : standingsTableOf(read.read, read.tiebreaks).rows;
    const [main, novices] = breakTables(
      [
        { id: 'main', seeds: 64, rows: table(whole) },
        { id: 'novice', seeds: 16, rows: table(novice) },
      ],
      {
        keyOf: (row) => row.entry,
        clearOf: clearByWinOrPoints(3),
        below: 3,
        open: new Set(),
      },
    );
    assert({
      given: 'the large table of 200 and its 60 novices',
      should:
        'put 58 clear of the main line, 6 near it and 133 below; set aside the 5 novices who made it',
      actual: [
        main?.clear.total,
        main?.near.length,
        (main?.below.length ?? 0) + (main?.more ?? 0),
        main?.near.at(-1)?.decisive,
        novices?.earlier.length,
        (novices?.clear.total ?? 0) + (novices?.near.length ?? 0),
      ],
      expected: [58, 6, 136, true, 5, 16],
    });
  });
});
