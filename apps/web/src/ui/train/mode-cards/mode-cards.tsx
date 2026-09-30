import Link from 'next/link';
import type { ModeCard, ModeId } from '../../../features/train/modes';
import { buttonClass } from '../../components/button/button-class';
import type { IconName } from '../../components/icon/icon';
import { cn } from '../../cn';
import { IconChip } from '../icon-chip/icon-chip';

const icons: Readonly<Record<ModeId, IconName>> = {
  practice: 'swords',
  drills: 'bolt',
  review: 'clock',
};

/** The three ways to train, side by side; stacked on the phone. */
export function ModeCards({ cards }: { readonly cards: readonly ModeCard[] }) {
  return (
    <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
      {cards.map((card) => (
        <li
          key={card.id}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-1"
        >
          <div className="flex items-start gap-4">
            <IconChip name={icons[card.id]} />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-md font-strong text-ink">{card.title}</h3>
                <span className="text-sm text-ink-faint">{card.status}</span>
              </div>
              <p className="text-sm text-ink-muted">{card.blurb}</p>
            </div>
          </div>
          {card.cta ? (
            <Link
              href={card.cta.href}
              className={cn(
                buttonClass('secondary'),
                'mt-auto no-underline hover:no-underline',
              )}
            >
              {card.cta.label}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
