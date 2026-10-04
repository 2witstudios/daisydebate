import type { DrillScreen } from '../../../features/train/drill-view';
import { initialDrill } from '../../../features/train/drill';
import { TrainCard } from '../card/train-card';
import { BackLink } from '../back-link/back-link';
import { Meter } from '../meter/meter';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { DrillForm, type DrillAction } from './drill-form';

/** An argument drill: prompt, form, and what the check looks for. */
export function Drill({
  screen,
  action,
}: {
  readonly screen: DrillScreen;
  readonly action: DrillAction;
}) {
  return (
    <TrainPage>
      <BackLink href={screen.backHref}>Train</BackLink>
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        {screen.title}
      </h1>
      <TrainColumns
        asideLabel="About this drill"
        main={
          <section
            aria-label="Drill"
            className="rounded-lg border border-border bg-surface p-6 shadow-1"
          >
            <DrillForm
              key={`${screen.title}-${screen.round}`}
              action={action}
              initial={initialDrill}
              screen={screen}
            />
          </section>
        }
        aside={
          <TrainCard title="This session">
            <p className="flex items-center justify-between text-base text-ink">
              <span>Round</span>
              <b className="font-strong">{`${screen.round} of ${screen.rounds}`}</b>
            </p>
            <Meter value={screen.progress} label="Session progress" />
          </TrainCard>
        }
      />
    </TrainPage>
  );
}
