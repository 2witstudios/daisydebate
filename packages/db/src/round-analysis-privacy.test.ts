import { getTableColumns } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';
import { roundAnalysisPrivacyAdopter } from './round-analysis-privacy';
import { roundTranscriptPrivacyAdopter } from './round-transcript-privacy';
import { roundAnalyses } from './schema/round-analyses';

setupRitewayBun();

test('round analysis declarations match every round_analyses column in their own adopter', () => {
  assert({
    given: 'the actual round_analyses Drizzle schema',
    should:
      'declare each column exactly once while the pending lawful basis holds activation',
    actual: validatePrivacyAdoption(
      {
        round_analyses: Object.values(getTableColumns(roundAnalyses)).map(
          (column) => column.name,
        ),
      },
      roundAnalysisPrivacyAdopter.fields,
    ),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'the report',
    should: 'be personal and private, deleted on erasure, never exported',
    actual: roundAnalysisPrivacyAdopter.fields
      .filter((field) => field.category === 'personal')
      .map(({ column, visibility, erasure, exportable }) => [
        column,
        visibility,
        erasure,
        exportable,
      ]),
    expected: [['report', 'private', 'delete', false]],
  });
  assert({
    given: 'the transcript adopter',
    should: 'declare no round analysis table',
    actual: roundTranscriptPrivacyAdopter.fields.some(
      (field) => field.table === 'round_analyses',
    ),
    expected: false,
  });
});
