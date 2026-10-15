import type { SpectateView } from '../../../features/watch/spectate-view';
import { StatusLine } from '../../components/status-line/status-line';

export type SpeechListProps = {
  readonly speeches: SpectateView['speeches'];
  readonly live: boolean;
};

/** The transcript as it is spoken, or the final transcript once it has ended. */
export function SpeechList({ speeches, live }: SpeechListProps) {
  return (
    <section aria-label="Transcript" className="flex flex-col gap-3">
      <p className="text-xs text-ink-faint">
        {live ? 'Following live' : 'Final transcript'}
      </p>
      <ol
        tabIndex={0}
        aria-label="Speech transcript"
        aria-live="polite"
        className="flex flex-col gap-4"
      >
        {speeches.map((speech) => (
          <li key={speech.stamp} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-wider text-ink-faint uppercase">
              <span>{`${speech.seat} · ${speech.handle}`}</span>
              <span className="tabular-nums">{speech.stamp}</span>
              {speech.speakingNow ? (
                <StatusLine tone="live">Speaking now</StatusLine>
              ) : null}
            </div>
            <p className="text-base text-ink">{speech.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
