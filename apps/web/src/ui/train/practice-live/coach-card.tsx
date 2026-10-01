import type { SpeechView } from '../../../features/train/live';
import { TrainCard } from '../card/train-card';

/** Coach prompts and, when opened, the hint; absent when coaching is off. */
export function CoachCard({
  view,
  hintOpen,
}: {
  readonly view: SpeechView;
  readonly hintOpen: boolean;
}) {
  const hint = hintOpen ? view.hint : null;
  if (view.prompts === null)
    return hint === null ? null : (
      <TrainCard title="Hint">
        <p className="text-base text-ink">{hint}</p>
      </TrainCard>
    );
  return (
    <TrainCard title="Coach prompts" sample>
      <ul className="flex flex-col gap-2">
        {view.prompts.map((prompt) => (
          <li key={prompt} className="flex gap-3 text-base text-ink">
            <span
              className="mt-2 h-2 w-2 shrink-0 rounded-round bg-accent"
              aria-hidden="true"
            />
            {prompt}
          </li>
        ))}
      </ul>
      {hint === null ? null : (
        <p className="rounded-md bg-gold-soft p-3 text-sm text-ink">
          <b className="font-strong text-gold">Hint.</b> {hint}
        </p>
      )}
      <p className="text-sm text-ink-faint">
        Prompts and hints are free. They are not scored.
      </p>
    </TrainCard>
  );
}
