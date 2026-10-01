import { isParticipant, type WatchViewer } from './debate';
import {
  dayLabel,
  minutesLabel,
  modeLabel,
  resultLabel,
  rulesLabel,
  visibilityLabel,
} from './labels';
import { debaterName, type RecordedDebate } from './recordings-list';
import { replayHref } from './routes';

type RowSeat = { readonly name: string; readonly rating: number };

/** One recording as an archive row shows it. */
export type RecordingRow = {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly ranked: boolean;
  readonly mode: string;
  readonly rules: string;
  readonly length: string;
  readonly date: string;
  readonly aff: RowSeat;
  readonly neg: RowSeat;
  readonly result: string;
  readonly pending: boolean;
  /** Set only on the viewer's own recordings: who can open it, and until when. */
  readonly own: {
    readonly visibility: string;
    readonly keptUntil: string | null;
  } | null;
};

/** The archive row for a recording, as seen by the viewer. */
export function recordingRowOf(
  debate: RecordedDebate,
  viewer: WatchViewer,
): RecordingRow {
  const { recording, ballots } = debate.state;
  return {
    id: debate.id,
    href: replayHref(debate.id),
    title: debate.title,
    ranked: debate.mode === 'ranked',
    mode: modeLabel(debate.mode),
    rules: rulesLabel(debate),
    length: minutesLabel(recording.lengthSeconds),
    date: dayLabel(recording.endedAt),
    aff: { name: debaterName(debate.aff, viewer), rating: debate.aff.rating },
    neg: { name: debaterName(debate.neg, viewer), rating: debate.neg.rating },
    result: resultLabel(ballots),
    pending: ballots.state === 'pending',
    own: isParticipant(debate, viewer)
      ? {
          visibility: visibilityLabel(debate.visibility),
          keptUntil: recording.keptUntil,
        }
      : null,
  };
}
