import {
  isNamedSeat,
  type Ballot,
  type RoundBallotRead,
  type RoundTranscriptRead,
  type RoundView,
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
  readonly voided: boolean;
  readonly ballot: Ballot;
};

export type ResultCoaching =
  | { readonly kind: 'ready'; readonly text: string }
  | { readonly kind: 'note'; readonly text: string };

export type TranscriptSection = {
  readonly key: string;
  readonly heading: string;
  readonly side: 'affirmative' | 'negative';
  readonly status?: 'capturing' | 'partial' | 'complete' | 'pending';
  readonly lines: readonly {
    readonly id: string;
    readonly speaker: string;
    readonly text: string;
    readonly partial: boolean;
  }[];
};

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
    voided: entry.status === 'voided',
    ballot: entry.ballot,
  }));
}

/**
 * The reader's own AI coaching (ADR 0071): the text, or a plain note saying
 * where it is or why there is none. Null for anyone who did not debate.
 */
export function resultCoaching(view: RoundBallotRead): ResultCoaching | null {
  const { coaching } = view;
  if (!coaching) return null;
  switch (coaching.status) {
    case 'ready':
      return { kind: 'ready', text: coaching.text };
    case 'in-ballot':
      return {
        kind: 'note',
        text: 'Your coaching is the AI judge’s feedback for you on its ballot above.',
      };
    case 'pending':
      return {
        kind: 'note',
        text: 'Your coaching is being written. Reload this page in a minute.',
      };
    case 'unavailable':
      return {
        kind: 'note',
        text: 'AI coaching is not available for this round.',
      };
  }
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
  return sectionsOf(view.round, transcript.utterances);
}

function sectionsOf(
  round: RoundView,
  utterances: NonNullable<RoundBallotRead['transcript']>['utterances'],
): readonly TranscriptSection[] {
  const speaker = (participantId: string) => {
    const seat = round.participants
      .filter(isNamedSeat)
      .find((p) => p.id === participantId);
    return seat ? seat.label : 'Unknown speaker';
  };
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
        },
      ],
    });
  }
  return [...sections.values()];
}

/** Only explicit open coverage can claim capture; a freeze always closes it. */
export function transcriptState(
  view: RoundTranscriptRead,
): NonNullable<TranscriptSection['status']> {
  if (view.freeze)
    return view.freeze.completeness === 'complete' ? 'complete' : 'partial';
  if (view.streams.some((s) => s.state === 'partial')) return 'partial';
  return view.streams.some((s) => s.state === 'open') ? 'capturing' : 'pending';
}

/** Viewer-neutral sections: authorization has already happened at the read boundary. */
export function liveTranscriptSections(
  view: RoundTranscriptRead,
): readonly TranscriptSection[] {
  const sections = sectionsOf(view.round, view.utterances);
  return view.round.segments.map((segment) => {
    const existing = sections.find((s) => s.key === `${segment.sequence}`);
    const streams = view.streams.filter((s) => s.segmentId === segment.id);
    const status = streamStatus(streams, view.freeze?.completeness ?? null);
    return {
      ...(existing ?? emptySection(view.round, segment.sequence)),
      status,
    };
  });
}

function emptySection(round: RoundView, sequence: number): TranscriptSection {
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
 * A frozen speech with no capture stream had no speaking interval to capture,
 * so it reads as its durable freeze does; before the freeze it is pending.
 */
function streamStatus(
  streams: RoundTranscriptRead['streams'],
  frozen: 'complete' | 'incomplete' | null,
): NonNullable<TranscriptSection['status']> {
  const open = streams.some((s) => s.state === 'open');
  if (streams.some((s) => s.state === 'partial') || (frozen && open))
    return 'partial';
  if (open) return 'capturing';
  if (streams.length > 0 && streams.every((s) => s.state === 'complete'))
    return 'complete';
  if (frozen === null) return 'pending';
  return frozen === 'complete' ? 'complete' : 'partial';
}
