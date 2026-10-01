import type { DrillScreen } from '../../../features/train/drill-view';
import { initialDrill } from '../../../features/train/drill';
import { TrainCard } from '../card/train-card';
import { BackLink } from '../back-link/back-link';
import { Meter } from '../meter/meter';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { DrillForm, type DrillAction } from './drill-form';

const lookFor = [
  [
    'Claim',
    'One sentence the other side could disagree with.',
    'Sample: Cities should fund transit first.',
  ],
  [
    'Warrant',
    'The reason it is true, with the mechanism.',
    'Sample: Jobs and clinics only serve people who can reach them.',
  ],
  [
    'Impact',
    'Why it matters, and for whom.',
    'Sample: Households with no car lose the most.',
  ],
] as const;

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
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {screen.title}
        </h1>
        <p className="text-base text-ink-muted">
          Write a claim, a warrant and an impact. Get feedback. Revise and save.
        </p>
      </header>
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
          <>
            <TrainCard title="What the check looks for" sample>
              {lookFor.map(([name, line, sample]) => (
                <p key={name} className="flex flex-col gap-1">
                  <span className="text-base font-strong text-ink">{name}</span>
                  <span className="text-sm text-ink-muted">{line}</span>
                  <span className="text-sm text-ink-faint">{sample}</span>
                </p>
              ))}
              <p className="text-sm text-ink-muted">
                The check runs as you ask for it. It looks for the three parts
                and for vague phrases. It does not decide whether you are right.
              </p>
            </TrainCard>
            <TrainCard title="This session">
              <p className="flex items-center justify-between text-base text-ink">
                <span>Round</span>
                <b className="font-strong">{`${screen.round} of ${screen.rounds}`}</b>
              </p>
              <Meter value={screen.progress} label="Session progress" />
              <p className="text-sm text-ink-muted">
                {screen.rounds === 1
                  ? 'One round is about 5 minutes.'
                  : 'Two rounds is about 8 minutes. You can stop after any round.'}
              </p>
            </TrainCard>
          </>
        }
      />
    </TrainPage>
  );
}
