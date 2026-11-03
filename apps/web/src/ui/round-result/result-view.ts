import {
  isNamedSeat,
  type Ballot,
  type RoundBallotRead,
  type LiveTranscriptRead,
} from '@daisy/protocol';
import { seatLabel } from '../rooms/room-page/assembly-controls';
import { speechName } from '../../features/debate-room/vocabulary';

type Released = RoundBallotRead['ballots'][number];

export type ResultBallot = {
  readonly title: string;
  /** Who decided, by kind only: a judge's identity never reaches the page. */
  readonly author: string;
  /** The heading over this ballot's feedback for the reader. */
  readonly feedbackTitle: string;
  readonly ballot: Ballot;
  /** Set when this reader may report this ballot's feedback (WATCH-7). */
  readonly reportableFeedbackId: string | null;
};

export type TranscriptSection = {
  readonly key: string;
  readonly heading: string;
  readonly side: 'affirmative' | 'negative';
  readonly status?: 'capturing' | 'partial' | 'complete' | 'pending';
  readonly lines: readonly TranscriptLine[];
  /** Required speech with no capture; the live read reports these. */
  readonly gaps?: readonly TranscriptGap[];
};
type TranscriptLine = {
  readonly id: string;
  readonly speaker: string;
  readonly text: string;
  readonly partial: boolean;
  readonly startOffsetMs: number | null;
};
type TranscriptGap = {
  readonly key: string;
  readonly speaker: string;
  readonly fromOffsetMs: number;
  readonly untilOffsetMs: number;
};
export type TranscriptItem =
  | ({ readonly kind: 'line' } & TranscriptLine)
  | ({ readonly kind: 'gap' } & TranscriptGap);

/** A section's lines in order, each gap placed before the first line captured after it. */
export function sectionItems(
  section: TranscriptSection,
): readonly TranscriptItem[] {
  const gaps = [...(section.gaps ?? [])].sort(
    (a, b) => a.fromOffsetMs - b.fromOffsetMs,
  );
  const items: TranscriptItem[] = [];
  for (const line of section.lines) {
    while (
      gaps[0] &&
      line.startOffsetMs !== null &&
      gaps[0].fromOffsetMs <= line.startOffsetMs
    )
      items.push({ kind: 'gap', ...gaps.shift()! });
    items.push({ kind: 'line', ...line });
  }
  return [...items, ...gaps.map((gap) => ({ kind: 'gap' as const, ...gap }))];
}

const author = (entry: Released) =>
  entry.judge === 'ai' ? 'AI judge' : 'Human judge';

/** "AI" keeps its capitals mid-sentence; "human" does not need one. */
const judgeInSentence = (entry: Released) =>
  entry.judge === 'ai' ? 'AI judge' : 'human judge';

/** The released ballots in order, each titled and labelled with its kind of judge. */
export function resultBallots(view: RoundBallotRead): readonly ResultBallot[] {
  if (view.round.status !== 'completed') return [];
  return view.ballots.map((entry, index) => ({
    title: `Ballot ${index + 1} · ${author(entry)}`,
    author: author(entry),
    feedbackTitle: `Feedback for you from the ${judgeInSentence(entry)}`,
    ballot: entry.ballot,
    reportableFeedbackId: entry.reportableFeedbackId,
  }));
}

/**
 * The frozen transcript by speech, in the order it was played: each speech
 * named as the room names it, each line with its speaker's seat name.
 */
export function transcriptSections(
  view: RoundBallotRead,
): readonly TranscriptSection[] {
  const transcript = view.transcript;
  if (!transcript) return [];
  const sections = sectionsOf(view.round, transcript.utterances);
  const played = view.round.segments.filter((segment) =>
    transcript.gaps.some((gap) => gap.segmentId === segment.id),
  );
  const keys = new Set(sections.map((section) => section.key));
  return [
    ...sections,
    ...played
      .filter((segment) => !keys.has(`${segment.sequence}`))
      .map((segment) => emptySection(view.round, segment.sequence)),
  ]
    .sort((a, b) => Number(a.key) - Number(b.key))
    .map((section) => {
      const segment = view.round.segments.find(
        (each) => `${each.sequence}` === section.key,
      );
      return {
        ...section,
        gaps: transcript.gaps
          .filter((gap) => gap.segmentId === segment?.id)
          .map((gap) => gapRow(view.round, gap)),
      };
    });
}

/**
 * A transcript's lines by played position with their speaker's seat name,
 * for any card on the page that cites a line.
 */
export function transcriptLines(view: LiveTranscriptRead) {
  return view.utterances.map((line) => ({
    segment: line.segmentSequence,
    sequence: line.sequence,
    speaker: speakerOf(view.round, line.roundParticipantId),
    text: line.text,
  }));
}

const gapRow = (
  round: TranscriptRound,
  gap: {
    readonly roundParticipantId: string;
    readonly fromOffsetMs: number;
    readonly untilOffsetMs: number;
  },
): TranscriptGap => ({
  key: `${gap.roundParticipantId}:${gap.fromOffsetMs}`,
  speaker: speakerOf(round, gap.roundParticipantId),
  fromOffsetMs: gap.fromOffsetMs,
  untilOffsetMs: gap.untilOffsetMs,
});

/** The Round's fields a transcript renders; any fuller view satisfies it. */
type TranscriptRound = LiveTranscriptRead['round'];

const speakerOf = (round: TranscriptRound, participantId: string) =>
  round.participants.filter(isNamedSeat).find((p) => p.id === participantId)
    ?.label ?? 'Unknown speaker';

function sectionsOf(
  round: TranscriptRound,
  utterances: NonNullable<RoundBallotRead['transcript']>['utterances'],
): readonly TranscriptSection[] {
  const speaker = (participantId: string) => speakerOf(round, participantId);
  const sections = new Map<number, TranscriptSection>();
  for (const line of utterances) {
    const section =
      sections.get(line.segmentSequence) ??
      emptySection(round, line.segmentSequence);
    sections.set(line.segmentSequence, {
      ...section,
      lines: [
        ...section.lines,
        {
          id: line.id,
          speaker: speaker(line.roundParticipantId),
          text: line.text,
          partial: !line.complete,
          startOffsetMs: line.startOffsetMs,
        },
      ],
    });
  }
  return [...sections.values()];
}

/** Only explicit open coverage can claim capture; a freeze always closes it. */
export function transcriptState(
  view: LiveTranscriptRead,
): NonNullable<TranscriptSection['status']> {
  if (view.freeze)
    return view.freeze.completeness === 'complete' ? 'complete' : 'partial';
  if (view.streams.some((s) => s.state === 'partial')) return 'partial';
  return view.streams.some((s) => s.state === 'open') ? 'capturing' : 'pending';
}

/** Viewer-neutral sections: authorization has already happened at the read boundary. */
export function liveTranscriptSections(
  view: LiveTranscriptRead,
): readonly TranscriptSection[] {
  const sections = sectionsOf(view.round, view.utterances);
  return view.round.segments.map((segment) => {
    const existing = sections.find((s) => s.key === `${segment.sequence}`);
    const streams = view.streams.filter((s) => s.segmentId === segment.id);
    const status = streamStatus(streams, view.freeze !== null);
    return {
      ...(existing ?? emptySection(view.round, segment.sequence)),
      status,
      gaps: streams.flatMap((stream) =>
        stream.gaps.map((gap) =>
          gapRow(view.round, {
            roundParticipantId: stream.roundParticipantId,
            ...gap,
          }),
        ),
      ),
    };
  });
}

function emptySection(
  round: TranscriptRound,
  sequence: number,
): TranscriptSection {
  const played = round.segments[sequence];
  const rules = round.rules.segments.find(
    (s) => s.key === played?.rulesSegmentKey,
  );
  return {
    key: `${sequence}`,
    heading: rules
      ? `${speechName(rules)} · ${seatLabel(rules.side, rules.slot)}`
      : `Speech ${sequence + 1}`,
    side: rules?.side ?? 'affirmative',
    lines: [],
  };
}
/**
 * Finalization closes a stream for every speaking interval a seat owes, so a
 * frozen speech with no stream owed no text: it is complete whatever the
 * Round's completeness (another speech's partial stream says which one fell
 * short). Before the freeze it is pending.
 */
function streamStatus(
  streams: LiveTranscriptRead['streams'],
  frozen: boolean,
): NonNullable<TranscriptSection['status']> {
  const open = streams.some((s) => s.state === 'open');
  if (streams.some((s) => s.state === 'partial') || (frozen && open))
    return 'partial';
  if (open) return 'capturing';
  if (streams.length > 0 && streams.every((s) => s.state === 'complete'))
    return 'complete';
  return frozen ? 'complete' : 'pending';
}
