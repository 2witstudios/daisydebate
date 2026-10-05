import Link from 'next/link';
import { drillParts, type DrillState } from '../../../features/train/drill';
import type { DrillScreen } from '../../../features/train/drill-view';
import { buttonClass } from '../../components/button/button-class';
import { sampleActionMessage } from '../../components/sample-action/sample-action-href';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { labels } from './drill-labels';

/**
 * After Save argument: the argument and where to go next. Nothing persists
 * yet, so it answers with the sample-action message, never a saved claim.
 */
export function Saved({
  state,
  screen,
}: {
  readonly state: DrillState;
  readonly screen: DrillScreen;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink">
          <Icon name="check" size={20} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-bold text-ink">
            {sampleActionMessage('Save argument')}
          </h2>
        </div>
      </div>
      <p className="flex flex-col gap-2 rounded-md bg-surface-sunken p-4 text-base text-ink">
        {drillParts.map((part) => (
          <span key={part}>
            <b className="font-strong">{labels[part]}.</b> {state.text[part]}
          </span>
        ))}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={screen.afterSave.href}
          className={cn(
            buttonClass('secondary'),
            'no-underline hover:no-underline',
          )}
        >
          {screen.afterSave.label}
        </Link>
        <Link
          href={screen.reviewHref}
          className={cn(
            buttonClass('primary'),
            'no-underline hover:no-underline',
          )}
        >
          Open review queue
        </Link>
      </div>
    </div>
  );
}
