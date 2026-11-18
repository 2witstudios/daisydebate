import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  daisyWinnerBallot,
  judgeSeat,
  sideSeat,
  panelRuleFor,
  type FormatDefinition,
} from '@daisy/protocol';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from '@daisy/protocol/lobby/result-record';
import { replaceResultCompetitionRecord } from '@daisy/protocol/lobby/result-record-correction';
import { standings } from '@daisy/tab-engine';
import { engineSettings } from '../operations/engine-settings';
import { projectResultCompetition } from './result-projection';

setupRitewayBun();
const id = (s: string) => s.repeat(24);
const definition = {
  ...daisyWinnerBallot,
  key: 'three-judge-test',
  points: {
    ...daisyWinnerBallot.points!,
    scale: { min: 1, max: 10, step: 1 },
    criteria: { kind: 'holistic' as const },
  },
};
const format: FormatDefinition = {
  ...oneOnOneFormatFixture,
  seats: { ...oneOnOneFormatFixture.seats, judges: 3 },
};
const record = (): Extract<ResultCompetitionRecord, { kind: 'decided' }> => ({
  version: 1,
  kind: 'decided',
  format: { formatId: 'three-judge-test', formatVersion: 1 },
  fixture: {
    kind: 'pairing',
    entries: [
      { entryId: id('a'), side: 'affirmative' },
      { entryId: id('b'), side: 'negative' },
    ],
  },
  source: {
    roundId: id('r'),
    freezeRevision: 1,
    finalization: { commandId: id('z'), resultingVersion: 8 },
    judgeAssignments: ['g', 'h', 'i'].map((letter, slot) => ({
      slot,
      versions: [
        {
          version: 1,
          participantId: id(letter),
          actorId: id(['j', 'k', 'l'][slot]!),
          source: 'initial' as const,
          commandId: null,
          recordedAt: '2026-11-14T08:00:00.000Z',
        },
      ],
    })),
    rules: fixtureRules(format),
    judging: {
      source: { kind: 'stored', id: id('w'), version: definition.revision },
      ballot: definition,
      panel: panelRuleFor(definition, 3),
    },
  },
  pointUnit: { numerator: '1', denominator: '1' },
  cast: [
    {
      participantId: id('c'),
      actorId: id('d'),
      entryId: id('a'),
      seat: sideSeat('affirmative'),
    },
    {
      participantId: id('e'),
      actorId: id('f'),
      entryId: id('b'),
      seat: sideSeat('negative'),
    },
    ...['g', 'h', 'i'].map((s, slot) => ({
      participantId: id(s),
      actorId: id(['j', 'k', 'l'][slot]!),
      entryId: null,
      seat: judgeSeat(slot),
    })),
  ],
  panel: ['g', 'h', 'i'].map((s, i) => ({
    tournamentJudgeId: id(['m', 'n', 'o'][i]!),
    participantId: id(s),
    ballot: {
      kind: 'submitted',
      ballotId: id(['p', 'q', 's'][i]!),
      contentDigest: String(i + 1).repeat(64),
      submittedAt: '2027-01-01T00:00:00.000Z',
      contribution: {
        rubricVersion: 'three-judge-test@2',
        winner: i === 2 ? 'negative' : 'affirmative',
        scores: { affirmative: [8, 7, 6][i]!, negative: [6, 6, 9][i]! },
      },
    },
  })),
});
const identity = {
  id: id('t'),
  fixture: id('u'),
  supersedes: null,
  certified: false,
};

test('result projections preserve each real ballot and never split a side score into speaker points', () => {
  const stored = JSON.parse(JSON.stringify(record()));
  const answer = projectResultCompetition(stored, identity);
  assert({
    given: 'a serialized three-judge competition record',
    should:
      'derive majority, actual ordered judges and contributions from that record alone',
    actual:
      answer.kind === 'projected'
        ? [
            answer.projection.engine.outcome,
            answer.projection.entries,
            answer.projection.speakers,
          ]
        : answer,
    expected: [
      {
        kind: 'winner',
        winner: id('a'),
        ballots: [
          {
            judge: id('m'),
            winner: id('a'),
            points: [
              { entry: id('a'), points: 8 },
              { entry: id('b'), points: 6 },
            ],
          },
          {
            judge: id('n'),
            winner: id('a'),
            points: [
              { entry: id('a'), points: 7 },
              { entry: id('b'), points: 6 },
            ],
          },
          {
            judge: id('o'),
            winner: id('b'),
            points: [
              { entry: id('a'), points: 6 },
              { entry: id('b'), points: 9 },
            ],
          },
        ],
      },
      [
        { entryId: id('a'), won: true, rank: null, ballotsWon: 2 },
        { entryId: id('b'), won: false, rank: null, ballotsWon: 1 },
      ],
      [],
    ],
  });
});

test('a correction preserves submission provenance while producing its new contributions', () => {
  const original = record();
  const replacement = replaceResultCompetitionRecord(original, {
    kind: 'decided',
    contributions: original.panel.map((judge) => ({
      participantId: judge.participantId,
      contribution:
        judge.ballot.kind === 'submitted'
          ? { ...judge.ballot.contribution, winner: 'negative' }
          : {},
    })),
  });
  const corrected =
    replacement.kind === 'accepted'
      ? projectResultCompetition(replacement.record, {
          ...identity,
          id: id('v'),
          supersedes: identity.id,
        })
      : replacement;
  assert({
    given: 'a full replacement making every actual judge contribution negative',
    should:
      'retain frozen references and originals while projecting the correction',
    actual: [
      corrected.kind === 'projected' ? corrected.projection.engine : null,
      original.panel.map((judge) =>
        judge.ballot.kind === 'submitted'
          ? judge.ballot.contribution.winner
          : null,
      ),
      replacement.kind === 'accepted' && replacement.record.kind === 'decided'
        ? replacement.record.panel.map((judge) =>
            judge.ballot.kind === 'submitted'
              ? judge.ballot.contentDigest
              : null,
          )
        : null,
    ],
    expected: [
      {
        ...identity,
        id: id('v'),
        supersedes: identity.id,
        kind: 'decided',
        outcome: {
          kind: 'winner',
          winner: id('b'),
          ballots: ['m', 'n', 'o'].map((s, i) => ({
            judge: id(s),
            winner: id('b'),
            points: [
              { entry: id('a'), points: [8, 7, 6][i]! },
              { entry: id('b'), points: [6, 6, 9][i]! },
            ],
          })),
        },
      },
      ['affirmative', 'affirmative', 'negative'],
      ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
    ],
  });
});

test('invalid contributions refuse instead of projecting approximate or invented values', () => {
  const original = record();
  const invalid = {
    ...original,
    panel: original.panel.map((judge) => ({
      ...judge,
      ballot: {
        ...judge.ballot,
        contribution: {
          rubricVersion: 'three-judge-test@2',
          winner: 'affirmative',
          scores: { affirmative: 8.5, negative: 6 },
        },
      },
    })),
  };
  assert({
    given: 'a fractional score outside the actual pinned integer lattice',
    should: 'refuse validation and projection',
    actual: [
      resultCompetitionRecordSchema.safeParse(invalid).success,
      projectResultCompetition(invalid, identity),
    ],
    expected: [false, { kind: 'refused', refusal: 'outcome-mismatch' }],
  });
});

const rankedRecord = (
  orders: readonly (readonly string[])[],
): Extract<ResultCompetitionRecord, { kind: 'decided' }> => {
  const original = record();
  const speakers = ['a', 'b', 'c', 'd', 'e', 'f'];
  const judging = {
    source: { kind: 'stored' as const, id: id('w'), version: 1 },
    ballot: {
      key: 'ranked-section-test',
      revision: 1,
      decision: {
        kind: 'ranking' as const,
        of: 'speakers' as const,
        ties: false,
      },
      points: null,
      speakerRanks: false,
      written: {
        reason: { required: false, max: 100 },
        feedback: { required: false, max: 100 },
      },
    },
    panel: { decision: 'rank_sum' as const, quorum: 2 },
  };
  return {
    ...original,
    format: { formatId: 'six-speaker-test', formatVersion: 1 },
    pointUnit: null,
    fixture: {
      kind: 'section',
      entries: speakers.map((s) => ({ entryId: id(s), side: null })),
    },
    source: {
      ...original.source,
      judging,
      rules: {
        version: 3,
        sides: [],
        seats: { sides: {}, speakers: 6, judges: 3, moderators: 0 },
        outcome: { kind: 'ranking', of: 'speakers' },
        segments: speakers.map((s, slot) => ({
          key: `S${slot + 1}`,
          label: `Speaker ${slot + 1}`,
          type: 'speech',
          speak: { rights: 'one', seat: { kind: 'speaker', slot } },
          durationMs: 1000,
        })),
        inRoundPrep: null,
        countdownMs: 0,
        interaction: { yield: null, interruptions: { allowed: 'disabled' } },
      },
    },
    cast: [
      ...speakers.map((s, slot) => ({
        participantId: id(s),
        actorId: id(String(slot)),
        entryId: id(s),
        seat: { kind: 'speaker' as const, slot },
      })),
      ...original.cast.filter((person) => person.seat.kind === 'judge'),
    ],
    panel: original.panel.map((judge, i) => ({
      ...judge,
      ballot: {
        kind: 'submitted',
        ballotId: id(['p', 'q', 's'][i]!),
        contentDigest: String(i + 1).repeat(64),
        submittedAt: '2027-01-01T00:00:00.000Z',
        contribution: {
          rubricVersion: 'ranked-section-test@1',
          ranking: orders[i]!.map((s) => [id(s)]),
        },
      },
    })),
  };
};

test('equal aggregate rows retain different real rank contributions after reconnect', () => {
  const first = rankedRecord([
    ['b', 'a', 'c', 'd', 'e', 'f'],
    ['c', 'a', 'b', 'd', 'e', 'f'],
    ['b', 'c', 'd', 'e', 'a', 'f'],
  ]);
  const second = rankedRecord([
    ['b', 'a', 'c', 'd', 'e', 'f'],
    ['b', 'c', 'a', 'd', 'e', 'f'],
    ['b', 'c', 'd', 'a', 'e', 'f'],
  ]);
  const projections = [first, second].map((row) =>
    projectResultCompetition(JSON.parse(JSON.stringify(row)), identity),
  );
  assert({
    given:
      'two panels with the same entry rank, win count and total rank but different per-judge ranks',
    should:
      'retain the distinct rank-drop inputs instead of reconstructing ballots from aggregates',
    actual: projections.map((answer) =>
      answer.kind === 'projected'
        ? [
            answer.projection.entries.find((row) => row.entryId === id('a')),
            answer.projection.engine.outcome.kind === 'ranking' &&
            answer.projection.engine.kind === 'decided'
              ? answer.projection.engine.outcome.ballots.map(
                  (ballot) =>
                    ballot.ranks.find((row) => row.entry === id('a'))?.rank,
                )
              : null,
          ]
        : answer,
    ),
    expected: [
      [{ entryId: id('a'), won: null, rank: 3, ballotsWon: 0 }, [2, 2, 5]],
      [{ entryId: id('a'), won: null, rank: 3, ballotsWon: 0 }, [2, 3, 4]],
    ],
  });
});

test('result panel order follows actual judge seat order', () => {
  const original = record();
  assert({
    given: 'a swapped chair/member order over unchanged actual seats',
    should: 'refuse the changed panel provenance',
    actual: resultCompetitionRecordSchema.safeParse({
      ...original,
      panel: [original.panel[1], original.panel[0], original.panel[2]],
    }).success,
    expected: false,
  });
});

test('actual standings fold keeps different rank-drop values for equal result aggregates', () => {
  const records = [
    rankedRecord([
      ['b', 'a', 'c', 'd', 'e', 'f'],
      ['c', 'a', 'b', 'd', 'e', 'f'],
      ['b', 'c', 'd', 'e', 'a', 'f'],
    ]),
    rankedRecord([
      ['b', 'a', 'c', 'd', 'e', 'f'],
      ['b', 'c', 'a', 'd', 'e', 'f'],
      ['b', 'c', 'd', 'a', 'e', 'f'],
    ]),
  ];
  const settings = engineSettings([], [], {
    'room.timing': {
      preRoundPrepMs: 0,
      inRoundPrepMsPerSide: 0,
      countdownMs: 0,
    },
    'room.floor': { interruptions: null, yielding: null },
  });
  const values = records.map((record) => {
    const answer = projectResultCompetition(
      JSON.parse(JSON.stringify(record)),
      identity,
    );
    if (
      answer.kind !== 'projected' ||
      answer.projection.engine.outcome.kind !== 'ranking'
    )
      return answer.kind;
    const result = answer.projection.engine;
    if (result.kind !== 'decided' || result.outcome.kind !== 'ranking')
      return 'invalid';
    const table = standings({
      format: { outcome: 'ranking', of: 'speakers' },
      entries: record.fixture.entries.map((entry) => ({
        id: entry.entryId,
        members: record.cast
          .filter((person) => person.entryId === entry.entryId)
          .map((person) => person.actorId),
        protection: [],
        division: null,
        status: 'active',
        breakEligible: true,
      })),
      history: {
        fixtures: [
          {
            id: identity.fixture,
            tabRound: 1,
            fixture: {
              kind: 'section',
              speakers: record.fixture.entries.map((entry) => entry.entryId),
              panel: record.panel.map((judge) => judge.tournamentJudgeId),
            },
          },
        ],
        results: [{ ...result, outcome: result.outcome }],
      },
      settings: {
        ...settings,
        'standings.tiebreaks': {
          metrics: ['cumulative_rank', 'worst_rank_drop'],
          minimumGames: null,
          terminal: 'shared',
        },
      },
      cutoff: 1,
      ratings: null,
      division: null,
      seed: new Uint8Array([1]),
    });
    return table.rows
      .find((row) => row.entry === id('a'))
      ?.values.map((value) => value.value);
  });
  assert({
    given:
      'equal aggregate entry rows with [2,2,5] versus [2,3,4] actual judge ranks',
    should:
      'keep the same rank sum and distinct worst-rank-drop totals after JSON reconnect',
    actual: values,
    expected: [
      [[{ n: 9, d: 1 }], [{ n: 4, d: 1 }]],
      [[{ n: 9, d: 1 }], [{ n: 5, d: 1 }]],
    ],
  });
});
