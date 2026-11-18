import { assert, setupRitewayBun, test } from 'riteway/bun';
import { daisyWinnerBallot, daisyBallotSource } from '../ballot-definition';

import {
  decidedRecord,
  recordId as id,
  criterionScores as scores,
} from './result-record.test-support';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from './result-record';
setupRitewayBun();
test('the result-owned competition record survives JSON without retaining written ballot text', () => {
  const record = decidedRecord();
  assert({
    given:
      'actual ordered cast/panel, consumed submission provenance and competitive contribution',
    should: 'round-trip as its own versioned immutable input',
    actual: resultCompetitionRecordSchema.parse(
      JSON.parse(JSON.stringify(record)),
    ),
    expected: record,
  });
  assert({
    given: 'private written feedback in a competitive contribution',
    should: 'refuse it rather than retain it as standings history',
    actual: resultCompetitionRecordSchema.safeParse({
      ...record,
      panel: record.panel.map((judge) => ({
        ...judge,
        ballot: {
          ...judge.ballot,
          contribution: {
            ...judge.ballot.contribution,
            reason: 'Private reason',
          },
        },
      })),
    }).success,
    expected: false,
  });
});
test('a competition record refuses invented or incomplete cast, panel and scores', () => {
  const record = decidedRecord();
  const invalid = [
    { ...record, cast: record.cast.slice(1) },
    { ...record, cast: [record.cast[0], record.cast[0], record.cast[2]] },
    { ...record, panel: [] },
    {
      ...record,
      panel: record.panel.map((judge) => ({
        ...judge,
        participantId: id('x'),
      })),
    },
    {
      ...record,
      panel: record.panel.map((judge) => ({
        ...judge,
        ballot: {
          ...judge.ballot,
          contribution: {
            ...judge.ballot.contribution,
            scores: { affirmative: {}, negative: scores(3) },
          },
        },
      })),
    },
    { ...record, pointUnit: { numerator: '1', denominator: '2' } },
  ];
  assert({
    given:
      'missing/repeated seats, absent/foreign panel, missing rubric scores or another unit',
    should: 'refuse each before it can become an authored result',
    actual: invalid.map(
      (candidate) => resultCompetitionRecordSchema.safeParse(candidate).success,
    ),
    expected: invalid.map(() => false),
  });
});
test('administrative awards are explicit credits, never fabricated submitted ballots', () => {
  const record: Extract<ResultCompetitionRecord, { kind: 'administrative' }> = {
    version: 1,
    kind: 'administrative',
    format: { formatId: 'freestyle', formatVersion: 1 },
    ballotSource: daisyBallotSource(daisyWinnerBallot),
    definition: daisyWinnerBallot,
    pointUnit: { numerator: '1', denominator: '1' },
    sourceRoundId: null,
    fixture: {
      kind: 'bye',
      entries: [{ entryId: id('a'), side: null, members: [id('d')] }],
    },
    reason: 'bye',
    awards: { kind: 'bye', rule: 'win', panelSize: 3 },
  };
  assert({
    given: 'a bye award with no Room or submitted judge ballot',
    should: 'preserve its explicit credit separately from decided ballots',
    actual: resultCompetitionRecordSchema.parse(record),
    expected: record,
  });
  assert({
    given: 'a fake panel attached to an administrative award',
    should: 'refuse it',
    actual: resultCompetitionRecordSchema.safeParse({
      ...record,
      panel: decidedRecord().panel,
    }).success,
    expected: false,
  });
});
