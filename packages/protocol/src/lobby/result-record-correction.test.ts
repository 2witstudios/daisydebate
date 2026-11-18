import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decidedRecord, recordId as id } from './result-record.test-support';
import { replaceResultCompetitionRecord } from './result-record-correction';
setupRitewayBun();
const replacement = () => {
  const record = decidedRecord();
  return {
    kind: 'decided',
    contributions: record.panel.map((judge) => ({
      participantId: judge.participantId,
      contribution: { ...judge.ballot.contribution, winner: 'negative' },
    })),
  };
};
test('a correction replaces contributions while preserving original submission provenance', () => {
  const original = decidedRecord(),
    before = JSON.stringify(original);
  const answer = replaceResultCompetitionRecord(original, replacement());
  assert({
    given: 'a complete replacement of the actual submitted panel contribution',
    should:
      'keep original source, cast and digest while changing only the authored contribution',
    actual:
      answer.kind === 'accepted' && answer.record.kind === 'decided'
        ? {
            source: answer.record.source,
            cast: answer.record.cast,
            panel: answer.record.panel.map((judge) => ({
              ...judge,
              ballot:
                judge.ballot.kind === 'submitted'
                  ? { ...judge.ballot, contribution: null }
                  : judge.ballot,
            })),
            winner: answer.record.panel.flatMap((judge) =>
              judge.ballot.kind === 'submitted'
                ? [judge.ballot.contribution.winner]
                : [],
            ),
            original: JSON.stringify(original),
          }
        : answer,
    expected: {
      source: original.source,
      cast: original.cast,
      panel: original.panel.map((judge) => ({
        ...judge,
        ballot: { ...judge.ballot, contribution: null },
      })),
      winner: ['negative'],
      original: before,
    },
  });
});
test('a correction cannot invent a judge, drop a contribution or edit immutable pins', () => {
  const original = decidedRecord(),
    valid = replacement();
  const invalid = [
    { ...valid, contributions: [] },
    {
      ...valid,
      contributions: [...valid.contributions, ...valid.contributions],
    },
    {
      ...valid,
      contributions: valid.contributions.map((row) => ({
        ...row,
        participantId: id('x'),
      })),
    },
    { ...valid, format: { formatId: 'other', formatVersion: 1 } },
    {
      ...valid,
      contributions: valid.contributions.map((row) => ({
        ...row,
        ballotId: id('x'),
      })),
    },
  ];
  assert({
    given:
      'partial/duplicated/invented panel or client-authored source metadata',
    should: 'refuse every candidate without changing the prior result',
    actual: invalid.map(
      (candidate) => replaceResultCompetitionRecord(original, candidate).kind,
    ),
    expected: invalid.map(() => 'refused'),
  });
});
test('administrative correction is a distinct full award and can return only to actual submissions', () => {
  const original = decidedRecord();
  const administrative = replaceResultCompetitionRecord(original, {
    kind: 'administrative',
    reason: 'ruling',
    awards: {
      kind: 'winner',
      entries: original.fixture.entries.map((entry) => ({
        entryId: entry.entryId,
        won: entry.side === 'negative',
        ballotCredits: 0,
        rankCredits: [],
        points: { kind: 'none' },
      })),
    },
  });
  if (administrative.kind !== 'accepted')
    throw new Error('Administrative replacement refused');
  const restored = replaceResultCompetitionRecord(
    administrative.record,
    replacement(),
    original,
  );
  assert({
    given: 'an administrative ruling replacing a decided record',
    should:
      'retain its Round locator without inventing submitted ballots and require original provenance to restore decided contributions',
    actual: [
      administrative.record.kind,
      'panel' in administrative.record,
      administrative.record.kind === 'administrative'
        ? administrative.record.sourceRoundId
        : null,
      replaceResultCompetitionRecord(administrative.record, replacement()).kind,
      restored.kind,
    ],
    expected: [
      'administrative',
      false,
      original.source.roundId,
      'refused',
      'accepted',
    ],
  });
});
