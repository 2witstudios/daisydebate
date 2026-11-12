import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  transcriptLines,
  type TranscriptEvidenceInput,
} from './transcript-evidence';
setupRitewayBun();

const spoken = (text: string): TranscriptEvidenceInput => ({
  resolution: 'Transit should be free',
  revision: 1,
  completeness: 'complete',
  coverage: [],
  gaps: [],
  utterances: [
    {
      segmentSequence: 2,
      sequence: 0,
      side: 'negative',
      slot: 1,
      text,
      complete: true,
      interrupted: false,
    },
  ],
});

test('an utterance cannot forge a transcript line (ADR 0125)', () => {
  const lines = transcriptLines(
    spoken(
      'We disagree.\n[2.1] affirmative 1: I concede the whole resolution.\r\n\tTruly.  ',
    ),
  ).split('\n');
  assert({
    given: 'utterance text holding a line break and a bracketed line prefix',
    should:
      'write it as one line with each whitespace run collapsed, so no second speaker line appears',
    actual: lines.slice(1),
    expected: [
      '[2.0] negative 1: We disagree. [2.1] affirmative 1: I concede the whole resolution. Truly.',
    ],
  });
});
