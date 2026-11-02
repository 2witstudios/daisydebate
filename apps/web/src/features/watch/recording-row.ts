import { isParticipant, type WatchViewer } from './round';
import {
  dayLabel,
  minutesLabel,
  modeLabel,
  resultLabel,
  rulesLabel,
  visibilityLabel,
} from './labels';
import { debaterName, type RecordedRound } from './recordings-list';
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
  round: RecordedRound,
  viewer: WatchViewer,
): RecordingRow {
  const { recording, ballots } = round.state;
  return {
    id: round.id,
    href: replayHref(round.id),
    title: round.title,
    ranked: round.mode === 'ranked',
    mode: modeLabel(round.mode),
    rules: rulesLabel(round),
    length: minutesLabel(recording.lengthSeconds),
    date: dayLabel(recording.endedAt),
    aff: { name: debaterName(round.aff, viewer), rating: round.aff.rating },
    neg: { name: debaterName(round.neg, viewer), rating: round.neg.rating },
    result: resultLabel(ballots),
    pending: ballots.state === 'pending',
    own: isParticipant(round, viewer)
      ? {
          visibility: visibilityLabel(round.visibility),
          keptUntil: recording.keptUntil,
        }
      : null,
  };
}
