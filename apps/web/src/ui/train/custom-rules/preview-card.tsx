import Link from 'next/link';
import {
  saveRuleSetHref,
  type CustomRulesQuery,
  type CustomRulesView,
} from '../../../features/train/custom-rules';
import { trainDestinations } from '../../../features/train/actions';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';

const link = 'no-underline hover:no-underline';

type Props = {
  readonly view: CustomRulesView;
  readonly query: CustomRulesQuery;
};

/** What the rules make, how they differ, and where they can and cannot go. */
export function PreviewCard({ view, query }: Props) {
  return (
    <TrainCard title="Preview">
      <p className="font-display text-xl font-bold text-ink">{view.name}</p>
      <p className="flex flex-wrap gap-2">
        <Badge tone="accent">Practice only</Badge>
        <Badge>{view.custom ? 'Custom rules' : 'Standard rules'}</Badge>
      </p>
      {view.differences.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {view.differences.map((line) => (
            <li key={line} className="flex gap-2 text-base text-ink">
              <span className="text-accent">
                <Icon name="check" size={16} />
              </span>
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-ink-muted">Standard rules</p>
      )}
      {view.saved ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-base text-accent"
        >
          <Icon name="check" size={16} />
          Saved
        </p>
      ) : (
        <Link
          href={saveRuleSetHref(query)}
          className={cn(buttonClass('secondary'), link)}
        >
          Save to my rule sets
        </Link>
      )}
      <Link
        href={view.practiceHref}
        className={cn(buttonClass('primary'), link)}
      >
        Practice with these rules
      </Link>
      <Link
        href={view.askRankedHref}
        className={cn(buttonClass('ghost'), link)}
      >
        Play this as ranked
      </Link>
      {view.ranked ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-live bg-live-soft p-4"
        >
          <b className="text-base font-strong text-ink">
            Ranked cannot use this table
          </b>
          <ul className="flex flex-col gap-1 text-base text-ink">
            {view.ranked.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link
              href={trainDestinations.findRanked}
              className={cn(buttonClass('primary'), link)}
            >
              Find a ranked match
            </Link>
            <Link
              href={view.closeRankedHref}
              className={cn(buttonClass('secondary'), link)}
            >
              Keep it as practice
            </Link>
          </div>
        </div>
      ) : null}
    </TrainCard>
  );
}
