import Link from 'next/link';
import {
  type CustomRulesQuery,
  type CustomRulesView,
  type RuleSetLink,
} from '../../../features/train/custom-rules';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { BackLink } from '../back-link/back-link';
import { TrainCard } from '../card/train-card';
import { PreviewCard } from './preview-card';
import { RulesCards } from './rules-card';
import { TrainColumns, TrainPage } from '../train-page/train-page';

export type CustomRulesProps = {
  readonly view: CustomRulesView;
  readonly query: CustomRulesQuery;
  readonly ruleSets: readonly RuleSetLink[];
};

const link = 'no-underline hover:no-underline';

/**
 * Custom rules for a practice: speech length, prep and seats, every change a
 * link, the name a one-field GET form. Practice only: ranked refuses these
 * rules and says why.
 */
export function CustomRules({ view, query, ruleSets }: CustomRulesProps) {
  return (
    <TrainPage>
      <BackLink href={view.backHref}>Train</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Practice with custom rules
        </h1>
        <p className="text-base text-ink-muted">
          Keep the same debate and change the rules: speech length, prep time or
          seats.
        </p>
      </header>
      <p className="flex items-start gap-3 rounded-lg border border-accent bg-accent-soft p-4 text-base text-ink">
        <Icon name="check" size={20} />
        <span className="flex flex-col">
          <b className="font-strong">Practice only. Never rated.</b>
          <span className="text-ink-muted">
            Custom rules run in practice rooms and never change a rating. Ranked
            always runs the standard rules, against people.
          </span>
        </span>
      </p>
      <TrainColumns
        asideLabel="Preview of your rules"
        main={
          <>
            <RulesCards view={view} query={query} />
          </>
        }
        aside={
          <>
            <PreviewCard view={view} query={query} />
            {ruleSets.length > 0 ? (
              <TrainCard title="Your rule sets">
                <ul className="flex flex-col gap-3">
                  {ruleSets.map((set) => (
                    <li
                      key={set.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-base text-ink">
                        {set.name}
                        <Badge>Unrated</Badge>
                      </span>
                      <Link
                        href={set.href}
                        aria-label={`Practice: ${set.name}`}
                        className={cn(buttonClass('secondary'), link)}
                      >
                        Practice
                      </Link>
                    </li>
                  ))}
                </ul>
              </TrainCard>
            ) : null}
            <TrainCard title="Running a tournament?" level={3}>
              <p className="text-sm text-ink-muted">
                Organizers run tournaments in their own tools. Those debates are
                unrated by default. Custom rules made here stay in practice.
              </p>
              <Link
                href="/tournaments"
                className="text-sm font-strong text-ink-muted"
              >
                About tournaments
              </Link>
            </TrainCard>
          </>
        }
      />
    </TrainPage>
  );
}
