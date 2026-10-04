import Link from 'next/link';
import {
  debriefHref,
  type DebriefQuery,
  type DebriefView,
} from '../../../features/train/debrief';
import type { PracticeConfig } from '../../../features/train/practice';
import type { HubQuery } from '../../../features/train/query';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';

type Props = {
  readonly view: DebriefView;
  readonly config: PracticeConfig;
  readonly plan: HubQuery;
  readonly query: DebriefQuery;
};

/** The speeches given, each a link that opens its notes. */
export function SpeechesCard({ view, config, plan, query }: Props) {
  return (
    <TrainCard title="Your speeches">
      <nav aria-label="Your speeches">
        <ul className="flex flex-col gap-2">
          {view.speeches.map((speech) => (
            <li key={speech.index}>
              <Link
                href={debriefHref(config, plan, query, {
                  speech: speech.index,
                })}
                aria-current={speech.selected ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-2 rounded-md border p-3 no-underline hover:no-underline',
                  speech.selected
                    ? 'border-accent bg-accent-soft'
                    : 'border-transparent',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-strong text-ink">
                    {speech.name}
                  </span>
                  <span className="text-sm text-ink-muted">{speech.used}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {speech.marks.map(([label, ok]) => (
                    <span
                      key={label}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-round px-2 py-1 text-xs font-strong',
                        ok
                          ? 'bg-accent-soft text-accent'
                          : 'bg-live-soft text-live',
                      )}
                    >
                      <Icon name={ok ? 'check' : 'alert'} size={12} />
                      {label}
                      <span className="sr-only">
                        {ok ? ': complete' : ': missing'}
                      </span>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </TrainCard>
  );
}
