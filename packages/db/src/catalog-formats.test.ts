import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  type RoomConfig,
} from '@daisy/protocol';
import { catalogFormats, type CatalogFormat } from './catalog-formats';

setupRitewayBun();

const format = (id: string): CatalogFormat => {
  const found = catalogFormats.find((entry) => entry.id === id);
  if (!found) throw new Error(`no catalog format ${id}`);
  return found;
};

/** A preset's in-round prep per side, or null when it is off. */
const prepMs = (id: string) => {
  const prep = format(id).preset.inRoundPrep;
  return prep.enabled ? prep.budgetMsPerSide : null;
};

/** "key side/slot minutes", the order a league's ballot reads. */
const schedule = (id: string) =>
  format(id).definition.segments.map(
    (segment) =>
      `${segment.key} ${segment.side === 'affirmative' ? 'A' : 'N'}${segment.slot} ${segment.defaultDurationMs / 60_000}`,
  );

describe('catalogFormats', () => {
  test('shape', () => {
    assert({
      given: 'every catalog entry',
      should: 'parse as a format definition and a room config',
      actual: catalogFormats.every(
        (entry) =>
          formatDefinitionSchema.safeParse(entry.definition).success &&
          roomConfigSchema.safeParse(entry.preset).success,
      ),
      expected: true,
    });
    assert({
      given: 'the catalog ids',
      should: 'be unique slugs',
      actual: new Set(catalogFormats.map((entry) => entry.id)).size,
      expected: catalogFormats.length,
    });
    assert({
      given: 'the standards',
      should: 'be exactly Policy, Value and Freestyle (FMT-2b)',
      actual: catalogFormats
        .filter((entry) => entry.role === 'standard')
        .map((entry) => [entry.id, entry.family]),
      expected: [
        ['policy', null],
        ['value', null],
        ['freestyle', null],
      ],
    });
    assert({
      given: 'every template',
      should: 'name a family, a league, a rules edition and a source',
      actual: catalogFormats
        .filter((entry) => entry.role === 'template')
        .every(
          (entry) =>
            entry.family !== null &&
            entry.leagues.length > 0 &&
            entry.rulesEdition !== null &&
            entry.sourceUrl?.startsWith('https://'),
        ),
      expected: true,
    });
  });

  test('Lincoln-Douglas', () => {
    assert({
      given: 'NSDA Lincoln-Douglas',
      should: 'run the NSDA 6-3-7-3-4-6-3 schedule with the opponent asking',
      actual: schedule('nsda-ld'),
      expected: [
        'AC A0 6',
        'CX1 N0 3',
        'NC N0 7',
        'CX2 A0 3',
        '1AR A0 4',
        'NR N0 6',
        '2AR A0 3',
      ],
    });
    assert({
      given: 'NCFCA and Stoa Lincoln-Douglas',
      should:
        'keep the NSDA speeches but differ in prep: 3 min, never before cross-ex, against a 4 min budget',
      actual: ['ncfca-ld', 'stoa-ld'].map((id) => ({
        same: schedule(id).join() === schedule('nsda-ld').join(),
        prepMs: prepMs(id),
        before: format(id).definition.configurable.inRoundPrep?.spendableBefore,
      })),
      expected: [
        { same: true, prepMs: 180_000, before: ['speech'] },
        { same: true, prepMs: 240_000, before: ['speech', 'cross_ex'] },
      ],
    });
  });

  test('team policy', () => {
    assert({
      given: 'NSDA Policy',
      should:
        'seat two a side, give each debater a constructive and a rebuttal, and have 2N, 1A, 1N, 2A ask',
      actual: schedule('nsda-policy'),
      expected: [
        '1AC A0 8',
        'CX1 N1 3',
        '1NC N0 8',
        'CX2 A0 3',
        '2AC A1 8',
        'CX3 N0 3',
        '2NC N1 8',
        'CX4 A1 3',
        '1NR N0 5',
        '1AR A0 5',
        '2NR N1 5',
        '2AR A1 5',
      ],
    });
    assert({
      given: 'the team policy templates',
      should:
        'carry 2v2 seats, ordered questioning and each league’s prep (NSDA 8, NDT 10, NCFCA 5 not before cross-ex)',
      actual: ['nsda-policy', 'college-policy', 'ncfca-tp'].map((id) => ({
        seats: format(id).definition.seats,
        mode: format(id).preset.crossExamination.crossExMode,
        prepMs: prepMs(id),
        before: format(id).definition.configurable.inRoundPrep?.spendableBefore,
      })),
      expected: [
        {
          seats: { affirmative: 2, negative: 2, judge: 1 },
          mode: 'ordered',
          prepMs: 480_000,
          before: ['speech', 'cross_ex'],
        },
        {
          seats: { affirmative: 2, negative: 2, judge: 1 },
          mode: 'ordered',
          prepMs: 600_000,
          before: ['speech', 'cross_ex'],
        },
        {
          seats: { affirmative: 2, negative: 2, judge: 1 },
          mode: 'ordered',
          prepMs: 300_000,
          before: ['speech'],
        },
      ],
    });
    assert({
      given: 'College Policy',
      should: 'run the NDT 9-3-6 schedule',
      actual: schedule('college-policy').map((row) => row.split(' ')[2]),
      expected: ['9', '3', '9', '3', '9', '3', '9', '3', '6', '6', '6', '6'],
    });
  });

  test('Public Forum and Big Questions', () => {
    assert({
      given: 'Public Forum',
      should:
        'run 4-4-3-4-4-3-3-3-3-2-2 with open crossfire and 3 min of prep a team',
      actual: {
        schedule: schedule('nsda-pf'),
        mode: format('nsda-pf').preset.crossExamination.crossExMode,
        prep: format('nsda-pf').preset.inRoundPrep,
      },
      expected: {
        schedule: [
          'AC1 A0 4',
          'NC1 N0 4',
          'CF1 A0 3',
          'AR A1 4',
          'NR N1 4',
          'CF2 A1 3',
          'AS A0 3',
          'NS N0 3',
          'GCF A0 3',
          'AFF A1 2',
          'NFF N1 2',
        ],
        mode: 'free',
        prep: { enabled: true, budgetMsPerSide: 180_000 },
      },
    });
    assert({
      given: 'Big Questions',
      should: 'run one-on-one with two shared 3 min question segments',
      actual: {
        seats: format('nsda-bq').definition.seats,
        questions: format('nsda-bq')
          .definition.segments.filter((s) => s.type === 'cross_ex')
          .map((s) => s.defaultDurationMs),
        mode: format('nsda-bq').preset.crossExamination.crossExMode,
      },
      expected: {
        seats: { affirmative: 1, negative: 1, judge: 1 },
        questions: [180_000, 180_000],
        mode: 'free',
      },
    });
  });

  test('pre-round prep', () => {
    assert({
      given: 'every catalog preset without a draw',
      should:
        'leave pre-round prep off: these resolutions are known in advance',
      actual: catalogFormats
        .filter((entry) => !entry.preset.resolutionDraw.enabled)
        .every((entry) => !entry.preset.preRoundPrep.enabled),
      expected: true,
    });
  });

  test('resolution strikes (FMT-2b)', () => {
    const strike = (id: string) => {
      const { preset } = format(id);
      return {
        draw: preset.resolutionDraw,
        preRoundPrep: preset.preRoundPrep,
        inRoundPrep: preset.inRoundPrep,
        capable: format(id).definition.configurable.resolutionDraw !== null,
      };
    };
    const bank: RoomConfig['resolutionDraw'] = {
      enabled: true,
      drawSize: 5,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
    };
    assert({
      given: 'Freestyle, IPDA and Team IPDA',
      should:
        'strike from 5 bank resolutions of any kind, Neg first, then prep: 20 min for Freestyle, the IPDA-recommended 30 for the leagues, none during the round',
      actual: ['freestyle', 'ipda', 'team-ipda'].map(strike),
      expected: [
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_200_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_800_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_800_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
      ],
    });
    assert({
      given: 'Freestyle',
      should: 'run the shared standard 1v1 schedule',
      actual: schedule('freestyle'),
      expected: schedule('value'),
    });
    assert({
      given: 'IPDA',
      should: 'run the IPDA bylaws’ 5-2-6-2-3-5-3 with the opponent asking',
      actual: schedule('ipda'),
      expected: [
        'AC A0 5',
        'CX1 N0 2',
        'NC N0 6',
        'CX2 A0 2',
        'AR A0 3',
        'NR N0 5',
        'AS A0 3',
      ],
    });
    assert({
      given: 'Team IPDA',
      should:
        'run 4-2-5-2-5-2-4-2 then 3-4-4-3 rebuttals with 2N, 1A, 1N, 2A asking',
      actual: schedule('team-ipda'),
      expected: [
        '1AC A0 4',
        'CX1 N1 2',
        '1NC N0 5',
        'CX2 A0 2',
        '2AC A1 5',
        'CX3 N0 2',
        '2NC N1 4',
        'CX4 A1 2',
        '1NR N0 3',
        '1AR A0 4',
        '2NR N1 4',
        '2AR A1 3',
      ],
    });
  });
});
