import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundTranscriptRead } from '@daisy/protocol';
import { completed } from './result.test-support';
import { liveTranscriptSections, transcriptState } from './result-view';
import { TranscriptContent } from './transcript-content';
setupRitewayBun();
const read = (
  state: 'open' | 'partial' | 'complete',
  frozen = false,
): RoundTranscriptRead => ({
  round: { ...completed.round, status: 'active' },
  revision: 3,
  freeze: frozen
    ? { completeness: state === 'complete' ? 'complete' : 'incomplete' }
    : null,
  streams: [
    {
      segmentId: completed.round.segments[0]!.id,
      roundParticipantId:
        completed.transcript!.utterances[0]!.roundParticipantId,
      state,
    },
  ],
  utterances: completed.transcript!.utterances,
});
test('durable closure and freeze decide labels without a deadline or viewer seat', () => {
  assert({
    given:
      'open, early partial, frozen partial, frozen open and frozen complete evidence',
    should: 'call only open unfrozen capture live and show partial immediately',
    actual: [
      transcriptState(read('open')),
      transcriptState(read('partial')),
      transcriptState(read('partial', true)),
      transcriptState(read('open', true)),
      transcriptState(read('complete', true)),
    ],
    expected: ['capturing', 'partial', 'partial', 'partial', 'complete'],
  });
});
test('an authorized transcript renders per speech with speakers and partial state in native markup', () => {
  const value = read('partial');
  const sections = liveTranscriptSections(value);
  const html = renderToString(
    h(TranscriptContent, { sections, empty: 'No speech was captured.' }),
  );
  assert({
    given: 'authorized text with no reader identity or seat prop',
    should:
      'render both speeches and their actual speakers and partial closure',
    actual: [
      sections.length,
      html.includes('Access improves.'),
      html.includes('Costs displace services'),
      html.includes('Partial'),
      html.includes('Sam Reyes'),
    ],
    expected: [2, true, true, true, true],
  });
});
test('a speech with no capture stream reads as its durable freeze', () => {
  const silent = (completeness: 'complete' | 'incomplete' | null) =>
    liveTranscriptSections({
      ...read('complete'),
      freeze: completeness && { completeness },
      streams: [],
    }).map((section) => section.status);
  assert({
    given:
      'speeches with no capture stream (no speaking interval) before a freeze, under a complete freeze and an incomplete one',
    should:
      'stay pending until the freeze, then follow its completeness instead of claiming a partial',
    actual: [silent(null), silent('complete'), silent('incomplete')],
    expected: [
      ['pending', 'pending'],
      ['complete', 'complete'],
      ['partial', 'partial'],
    ],
  });
});
