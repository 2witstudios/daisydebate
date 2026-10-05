import type { SpeechView } from '../../../features/train/live';
import { Icon } from '../../components/icon/icon';
import { TrainCard } from '../card/train-card';

/** What is being said: your speech as heard, or theirs with a notes box. */
export function TranscriptCard({ view }: { readonly view: SpeechView }) {
  return (
    <TrainCard title={view.yours ? 'Your speech' : 'Their speech'}>
      {view.yours ? (
        <>
          <p className="flex items-center gap-2 text-sm font-strong text-accent">
            <Icon name="message" size={16} />
            Listening to you
          </p>
          <p className="text-md text-ink">{view.text}</p>
        </>
      ) : (
        <>
          <p className="text-sm font-strong text-ink-muted">AI debater</p>
          <p className="text-md text-ink">{view.text}</p>
          <label htmlFor="notes" className="text-sm font-strong text-ink">
            Your notes
          </label>
          <textarea
            id="notes"
            rows={2}
            placeholder="Number their points here"
            className="rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
          />
        </>
      )}
    </TrainCard>
  );
}
