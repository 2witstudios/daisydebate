import type { SpectateView } from '../../../features/watch/spectate-view';
import { StatusLine } from '../../components/status-line/status-line';

export type SpeechListProps = {
  readonly speeches: SpectateView['speeches'];
  readonly live: boolean;
};

/** The transcript as it is spoken, or the final transcript once it has ended. */
export function SpeechList({ speeches, live }: SpeechListProps) {
  return (
    <section aria-label="Speeches" className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <h2 className="font-strong text-ink">Speeches as they are spoken</h2>
        <span>{live ? 'Following live' : 'Final transcript'}</span>
      </div>
      <ol
        tabIndex={0}
        aria-label="Speech transcript"
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface shadow-1"
      >
        {speeches.map((speech) => (
          <li key={speech.stamp} className="flex gap-4 p-4">
            <span className="w-10 shrink-0 text-sm text-ink-faint tabular-nums">
              {speech.stamp}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-strong text-ink">{speech.handle}</span>
                <span className="text-ink-faint">{speech.seat}</span>
                {speech.speakingNow ? (
                  <StatusLine tone="live">Speaking now</StatusLine>
                ) : null}
              </div>
              <p className="text-base text-ink-muted">{speech.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
