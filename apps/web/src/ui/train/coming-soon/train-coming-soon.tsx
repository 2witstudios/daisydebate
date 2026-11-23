import { TrainPage } from '../train-page/train-page';

/**
 * Train while bot debates are unreleased to the viewer: its heading and one
 * line, with no roster, no form and nothing to buy.
 */
export function TrainComingSoon() {
  return (
    <TrainPage>
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Train
      </h1>
      <p className="text-base text-ink-muted">Bot debates are coming soon.</p>
    </TrainPage>
  );
}
