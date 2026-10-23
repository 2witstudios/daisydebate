import { getTableColumns } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validatePrivacyAdoption } from './privacy/declarations';
import { roundTranscriptPrivacyAdopter } from './round-transcript-privacy';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { utterances } from './schema/utterances';

setupRitewayBun();

test('round transcript declarations match every utterance column and the pending judging tuple', () => {
  const names = (columns: Record<string, { name: string }>) =>
    Object.values(columns).map((column) => column.name);
  const expected = {
    utterances: names(getTableColumns(utterances)),
    round_judging_jobs: names(getTableColumns(roundJudgingJobs)).filter(
      (column) => column.startsWith('pending_ballot'),
    ),
  };
  assert({
    given: 'the actual utterances and round_judging_jobs Drizzle schema',
    should:
      'declare each column exactly once while the pending lawful basis holds activation',
    actual: validatePrivacyAdoption(
      expected,
      roundTranscriptPrivacyAdopter.fields,
    ),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'the transcript text, its capture digest and the cached judgment',
    should:
      'classify them personal and private, deleted on erasure, exporting only the text',
    actual: roundTranscriptPrivacyAdopter.fields
      .filter((field) => field.category === 'personal')
      .map(({ column, visibility, erasure, exportable }) => [
        column,
        visibility,
        erasure,
        exportable,
      ]),
    expected: [
      ['text', 'private', 'delete', true],
      ['capture_body_digest', 'private', 'delete', false],
      ['pending_ballot', 'private', 'delete', false],
    ],
  });
});
