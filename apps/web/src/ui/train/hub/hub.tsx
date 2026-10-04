import type { HubView } from '../../../features/train/hub';
import { PageHeader } from '../../components/page-header/page-header';
import { modeCards } from '../../../features/train/modes';
import type { HubQuery } from '../../../features/train/query';
import type { TrainingSummary } from '../../../features/train/summary';
import { CustomRulesBanner } from '../custom-rules-banner/custom-rules-banner';
import { ModeCards } from '../mode-cards/mode-cards';
import { NextCard } from '../next-card/next-card';
import { PlanPanel } from '../plan-panel/plan-panel';
import { RuleSetsCard } from '../saved-card/rule-sets-card';
import { SavedCard } from '../saved-card/saved-card';
import { PartBars } from '../structure-trend/part-bars';
import { StructureTrend } from '../structure-trend/structure-trend';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { WeekCard } from '../week-card/week-card';

export type TrainHubProps = {
  readonly view: HubView;
  readonly summary: TrainingSummary;
  readonly query: HubQuery;
};

/**
 * The Train hub for an account that has trained: today's plan, what to do
 * next, the three ways to train, progress and the week. The plan reads its
 * finished items from the URL until sessions are stored.
 */
export function TrainHub({ view, summary, query }: TrainHubProps) {
  const { structure } = summary;
  return (
    <TrainPage>
      <PageHeader title="Train" />
      <TrainColumns
        asideLabel="Training summary"
        main={
          <>
            <div className="grid grid-cols-dash-lower gap-6 max-compact:grid-cols-1 max-compact:gap-4">
              <PlanPanel
                stage={view.stage}
                dueTomorrow={summary.saved.dueTomorrow}
                plan={view.plan}
                totalMinutes={view.totalMinutes}
                query={query}
              />
              {view.next ? <NextCard next={view.next} query={query} /> : null}
            </div>
            <ModeCards cards={modeCards(summary, view.stage)} />
            {structure ? (
              <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
                <StructureTrend trend={structure.trend} />
                <PartBars parts={structure.parts} />
              </div>
            ) : null}
            <CustomRulesBanner />
          </>
        }
        aside={
          <>
            <WeekCard summary={summary} />
            <SavedCard summary={summary} />
            {summary.ruleSets.length > 0 ? (
              <RuleSetsCard summary={summary} />
            ) : null}
          </>
        }
      />
    </TrainPage>
  );
}
