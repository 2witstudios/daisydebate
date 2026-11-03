import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  capturePartialReasonSchema,
  type LiveTranscriptRead,
} from '@daisy/protocol';
import { completed } from './result.test-support';
import {
  liveTranscriptSections,
  sectionItems,
  transcriptSections,
  transcriptState,
} from './result-view';
import { TranscriptContent } from './transcript-content';
setupRitewayBun();
const read = (
  state: 'open' | 'partial' | 'complete',
  frozen = false,
): LiveTranscriptRead => ({
  contractVersion: 1,
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
      gaps: [],
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
test('a frozen speech with no capture stream owed no text', () => {
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
      'stay pending until the freeze, then read complete under either freeze, never claiming missing text',
    actual: [silent(null), silent('complete'), silent('incomplete')],
    expected: [
      ['pending', 'pending'],
      ['complete', 'complete'],
      ['complete', 'complete'],
    ],
  });
});

test('a gap sits where the capture stopped and shows the seat it belongs to', () => {
  const base = read('partial');
  const utterances = base.utterances.map((line, index) => ({
    ...line,
    segmentId: base.round.segments[0]!.id,
    segmentSequence: 0,
    sequence: index,
    startOffsetMs: index === 0 ? 355 : 251_900,
  }));
  const value: LiveTranscriptRead = {
    ...base,
    utterances,
    streams: base.streams.map((stream) => ({
      ...stream,
      gaps: [{ fromOffsetMs: 234_145, untilOffsetMs: 251_900 }],
    })),
  };
  const section = liveTranscriptSections(value)[0]!;
  assert({
    given: 'a line before and after a gap between epochs',
    should: 'keep the line before it, then the gap, then the line after',
    actual: sectionItems(section).map((item) => item.kind),
    expected: ['line', 'gap', 'line'],
  });
  const html = renderToString(
    h(TranscriptContent, { sections: [section], empty: '' }),
  );
  assert({
    given: 'the rendered gap',
    should: 'give its span with no explanation',
    actual:
      html.includes('not captured') &&
      html.includes('3:54') &&
      html.includes('4:12'),
    expected: true,
  });
});

test('a gap under a second still shows a real span', () => {
  const base = read('partial');
  const value: LiveTranscriptRead = {
    ...base,
    streams: base.streams.map((stream) => ({
      ...stream,
      gaps: [{ fromOffsetMs: 5200, untilOffsetMs: 5500 }],
    })),
  };
  const html = renderToString(
    h(TranscriptContent, {
      sections: [liveTranscriptSections(value)[0]!],
      empty: '',
    }),
  );
  assert({
    given: 'a 300 ms hole inside one second',
    should: 'round outward rather than read 0:05 to 0:05',
    actual: html.includes('0:05') && html.includes('0:06'),
    expected: true,
  });
});

test('a completed transcript says where a speech was partial, even a speech with no lines', () => {
  const played = completed.round.segments[0]!;
  const last = completed.round.segments.at(-1)!;
  const seat = completed.transcript!.utterances[0]!.roundParticipantId;
  const sections = transcriptSections({
    ...completed,
    transcript: {
      completeness: 'incomplete',
      partialStreams: [],
      utterances: completed.transcript!.utterances.filter(
        (line) => line.segmentId !== last.id,
      ),
      gaps: [
        {
          segmentId: played.id,
          roundParticipantId: seat,
          fromOffsetMs: 1000,
          untilOffsetMs: 2000,
        },
        {
          segmentId: last.id,
          roundParticipantId: seat,
          fromOffsetMs: 0,
          untilOffsetMs: 5000,
        },
      ],
    },
  });
  assert({
    given: 'gaps on a speech with lines and on one with none',
    should: 'show both, in played order',
    actual: [
      sections.at(0)?.gaps?.length,
      sections.at(-1)?.key,
      sections.at(-1)?.gaps?.length,
    ],
    expected: [1, `${last.sequence}`, 1],
  });
});

test('a partial speech with no gap says part of it was lost', () => {
  const html = renderToString(
    h(TranscriptContent, {
      sections: [liveTranscriptSections(read('partial'))[0]!],
      empty: '',
    }),
  );
  const gapped = liveTranscriptSections({
    ...read('partial'),
    streams: read('partial').streams.map((stream) => ({
      ...stream,
      gaps: [{ fromOffsetMs: 1000, untilOffsetMs: 2000 }],
    })),
  })[0]!;
  assert({
    given: 'a partial stream with nothing to place, and one with a gap',
    should: 'say a part was lost only where no gap can say where',
    actual: [html.includes('part of this speech was lost'), gapped.losses],
    expected: [true, []],
  });
});

test('a completed speech partial with no gap says the same, even with no lines', () => {
  const played = completed.round.segments[0]!;
  const seat = completed.transcript!.utterances[0]!.roundParticipantId;
  const sections = transcriptSections({
    ...completed,
    transcript: {
      ...completed.transcript!,
      utterances: [],
      gaps: [],
      partialStreams: [
        {
          segmentId: played.id,
          roundParticipantId: seat,
          reasons: [capturePartialReasonSchema.options[0]],
        },
      ],
    },
  });
  assert({
    given: 'a frozen partial stream with no gap and no lines',
    should: 'keep its section and name the loss',
    actual: sections.map((section) => section.losses?.length),
    expected: [1],
  });
});
