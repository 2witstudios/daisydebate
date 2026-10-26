import Link from 'next/link';
import type { PlayOption, PlayOptionId } from '../../../features/play/options';
import { cn } from '../../cn';
import { Badge } from '../../components/badge/badge';
import { Icon, type IconName } from '../../components/icon/icon';

const icons: Readonly<Record<PlayOptionId, IconName>> = {
  ranked: 'swords',
  room: 'plus',
  bot: 'bolt',
  events: 'trophy',
};

/** Each way to play keeps its own colour (ADR 0051) on a solid chip. */
const chips: Readonly<Record<PlayOptionId, string>> = {
  ranked: 'bg-hue-clay text-background',
  room: 'bg-hue-sky text-background',
  bot: 'bg-hue-plum text-background',
  events: 'bg-gold text-background',
};

/**
 * The ways to play as one compact list of links. The Play dialog shows it
 * over the Lobby and `/play` shows it as a page, so both read the same. One
 * that is not open yet is tagged and leads to its explainer.
 */
export function PlayChoices({
  options,
}: {
  readonly options: readonly PlayOption[];
}) {
  return (
    <ul className="flex flex-col" aria-label="Ways to play">
      {options.map((option) => (
        <li key={option.id} className="border-t border-border first:border-t-0">
          <Link
            href={option.href}
            className="flex items-center gap-4 rounded-md px-2 py-3 text-ink no-underline hover:bg-surface-overlay hover:no-underline"
          >
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-md',
                chips[option.id],
              )}
            >
              <Icon name={icons[option.id]} size={20} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-strong">{option.title}</span>
              <span className="text-sm text-ink-muted">{option.blurb}</span>
            </span>
            {option.comingSoon ? (
              <span className="ml-auto shrink-0">
                <Badge tone="accent">Coming soon</Badge>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
