import Link from 'next/link';
import {
  type CustomRulesQuery,
  type CustomRulesView,
  type RuleSetLink,
} from '../../../features/train/custom-rules';
import { buttonClass } from '../../components/button/button-class';
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
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Practice with custom rules
      </h1>
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
          </>
        }
      />
    </TrainPage>
  );
}
