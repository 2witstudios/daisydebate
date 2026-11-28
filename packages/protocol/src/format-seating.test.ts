import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { everySeatOf, speakingSeatsOf } from './format-seating';
import {
  authoredFormatDefinitionSchema,
  formatDefinitionSchema,
  roundRulesSchema,
  type FormatDefinition,
} from './format';
import { fourTeams, type SeatRef } from './seats';
import {
  fixtureRules,
  oneOnOneFormatFixture,
} from './format-fixtures.test-support';

setupRitewayBun();

const paths = (definition: unknown, schema = formatDefinitionSchema) =>
  schema
    .safeParse(definition)
    .error?.issues.map((issue) => issue.path.join('.')) ?? [];
const authoredPaths = (definition: unknown) =>
  paths(definition, authoredFormatDefinitionSchema);

const timed = (segments: FormatDefinition['segments']) =>
  Object.fromEntries(
    segments.map((segment) => [segment.key, { min: 60_000, max: 600_000 }]),
  );

/** A definition built from the one-on-one fixture's capabilities around new seating. */
const definitionWith = (
  seating: Pick<FormatDefinition, 'sides' | 'seats' | 'outcome' | 'segments'>,
): FormatDefinition => ({
  ...oneOnOneFormatFixture,
  ...seating,
  configurable: {
    ...oneOnOneFormatFixture.configurable,
    timing: {
      ...oneOnOneFormatFixture.configurable.timing,
      segmentDurationMs: timed(seating.segments),
    },
    inRoundPrep:
      seating.sides.length > 0
        ? oneOnOneFormatFixture.configurable.inRoundPrep
        : null,
  },
});

const speech = (key: string, seat: SeatRef) => ({
  key,
  label: key,
  type: 'speech' as const,
  speak: { rights: 'one' as const, seat },
  defaultDurationMs: 120_000,
});

const fourTeamDefinition = definitionWith({
  sides: [...fourTeams],
  seats: {
    sides: Object.fromEntries(fourTeams.map((team) => [team.key, 2])),
    speakers: 0,
    judges: 3,
    moderators: 1,
  },
  outcome: { kind: 'ranking', of: 'sides' },
  segments: fourTeams.flatMap((team, index) =>
    [0, 1].map((slot) =>
      speech(`S${index}${slot}`, { kind: 'side', side: team.key, slot }),
    ),
  ),
});

const unsidedDefinition = definitionWith({
  sides: [],
  seats: { sides: {}, speakers: 3, judges: 1, moderators: 1 },
  outcome: { kind: 'ranking', of: 'speakers' },
  segments: [
    ...[0, 1, 2].map((slot) => speech(`P${slot}`, { kind: 'speaker', slot })),
    {
      key: 'OPEN',
      label: 'Open floor',
      type: 'open' as const,
      speak: { rights: 'all' as const, lead: { kind: 'moderator', slot: 0 } },
      defaultDurationMs: 120_000,
    },
  ],
});

describe('format definition v2 seating', () => {
  test('accepts a four-team and an unsided definition, and compiles them', () => {
    assert({
      given: 'a four-team ranking format and an unsided speakers format',
      should: 'accept both, as definitions and as rules',
      actual: [fourTeamDefinition, unsidedDefinition].map((definition) => [
        paths(definition),
        roundRulesSchema.safeParse({
          ...fixtureRules(definition),
          inRoundPrep: null,
        }).success,
      ]),
      expected: [
        [[], true],
        [[], true],
      ],
    });
  });

  test('refuses a format that seats sides and unsided speakers at once', () => {
    assert({
      given: 'two sides and two unsided speakers',
      should: 'refuse the seating',
      actual: paths({
        ...oneOnOneFormatFixture,
        seats: { ...oneOnOneFormatFixture.seats, speakers: 2 },
      }),
      expected: ['seats.speakers'],
    });
  });

  test('refuses a strike without exactly two sides', () => {
    assert({
      given: 'a four-team format with a resolution strike',
      should: 'refuse the strike',
      actual: paths({
        ...fourTeamDefinition,
        configurable: {
          ...fourTeamDefinition.configurable,
          resolutionDraw: {
            drawSize: { min: 3, max: 5 },
            strikeWindowMs: { min: 15_000, max: 60_000 },
            firstStrikers: ['opening_government'],
            sources: ['bank'],
          },
        },
      }),
      expected: ['configurable.resolutionDraw'],
    });
  });

  test('refuses a ranking of speakers without speakers', () => {
    assert({
      given: 'a two-sided format ranking speakers',
      should: 'refuse the outcome',
      actual: paths({
        ...oneOnOneFormatFixture,
        outcome: { kind: 'ranking', of: 'speakers' },
      }),
      expected: ['outcome'],
    });
  });

  test('refuses a speak seat on an undeclared side', () => {
    assert({
      given: 'a speech by a side the format does not declare',
      should: 'refuse that speak seat',
      actual: paths({
        ...oneOnOneFormatFixture,
        segments: oneOnOneFormatFixture.segments.map((segment, index) =>
          index === 0
            ? {
                ...segment,
                speak: {
                  rights: 'one',
                  seat: { kind: 'side', side: 'government', slot: 0 },
                },
              }
            : segment,
        ),
      }),
      expected: ['segments.0.speak.seat'],
    });
  });

  test('refuses a judge in speak rights', () => {
    assert({
      given: 'a speech given to the judge, and a cross-ex led by the judge',
      should: 'refuse each judge seat',
      actual: paths({
        ...oneOnOneFormatFixture,
        segments: oneOnOneFormatFixture.segments.map((segment, index) =>
          index === 0
            ? {
                ...segment,
                speak: { rights: 'one', seat: { kind: 'judge', slot: 0 } },
              }
            : index === 1
              ? {
                  ...segment,
                  speak: { rights: 'all', lead: { kind: 'judge', slot: 0 } },
                }
              : segment,
        ),
      }),
      expected: ['segments.0.speak.seat', 'segments.1.speak.lead'],
    });
  });

  test('refuses a cross-examination that names no asking seat (INTX-10)', () => {
    assert({
      given: 'cross-examination open to every debater with no lead',
      should: 'refuse its lead, so no one is the asker and no bot asks first',
      actual: authoredPaths({
        ...oneOnOneFormatFixture,
        segments: oneOnOneFormatFixture.segments.map((segment, index) =>
          index === 1
            ? { ...segment, speak: { rights: 'all', lead: null } }
            : segment,
        ),
      }),
      expected: ['segments.1.speak.lead'],
    });
  });

  test('a stored cross-examination with no asker still parses', () => {
    assert({
      given:
        'the same unled cross-examination read back from storage rather than authored',
      should:
        'parse, so formats and Rounds saved before the asker rule stay readable',
      actual: paths({
        ...oneOnOneFormatFixture,
        segments: oneOnOneFormatFixture.segments.map((segment, index) =>
          index === 1
            ? { ...segment, speak: { rights: 'all', lead: null } }
            : segment,
        ),
      }),
      expected: [],
    });
  });

  test('refuses a cross-examination asked by an unsided speaker (INTX-10)', () => {
    assert({
      given:
        'the unsided format with its open floor made a cross-examination led by its first speaker',
      should:
        'refuse its lead: cross-examination is asked and answered across sides',
      actual: authoredPaths({
        ...unsidedDefinition,
        segments: unsidedDefinition.segments.map((segment) =>
          segment.key === 'OPEN'
            ? {
                ...segment,
                type: 'cross_ex' as const,
                speak: {
                  rights: 'all' as const,
                  lead: { kind: 'speaker' as const, slot: 0 },
                },
              }
            : segment,
        ),
      }),
      expected: ['segments.3.speak.lead'],
    });
  });

  test('refuses a speech shared by several seats', () => {
    assert({
      given: 'a speech with every seat speaking',
      should: 'refuse its rights',
      actual: paths({
        ...oneOnOneFormatFixture,
        segments: oneOnOneFormatFixture.segments.map((segment, index) =>
          index === 0
            ? { ...segment, speak: { rights: 'all', lead: null } }
            : segment,
        ),
      }),
      expected: ['segments.0.speak.rights'],
    });
  });
});

describe('speakingSeatsOf', () => {
  test('grants the floor to every seat but a judge on an open floor', () => {
    assert({
      given: 'the unsided format and its open floor',
      should: 'grant every speaker and the moderator, never the judge',
      actual: speakingSeatsOf(unsidedDefinition, { rights: 'all', lead: null }),
      expected: everySeatOf(unsidedDefinition).filter(
        (seat) => seat.kind !== 'judge',
      ),
    });
  });
});
