import Link from 'next/link';
import type { BotSelector } from '../../../features/train/bots';
import { trainDestinations } from '../../../features/train/actions';
import { BotPortrait } from '../../components/bot-portrait/bot-portrait';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainPage } from '../train-page/train-page';

const link = 'no-underline hover:no-underline';
const arrow =
  'flex size-12 shrink-0 items-center justify-center rounded-round border border-border-strong text-ink hover:border-ink-muted';

function Arrow({
  href,
  label,
  direction,
}: {
  readonly href: string | null;
  readonly label: string;
  readonly direction: 'previous' | 'next';
}) {
  const icon = (
    <Icon
      name="chevronRight"
      size={20}
      className={direction === 'previous' ? 'rotate-180' : undefined}
    />
  );
  if (href === null)
    return (
      <span aria-hidden="true" className={cn(arrow, 'opacity-30')}>
        {icon}
      </span>
    );
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className={cn(arrow, link)}
    >
      {icon}
    </Link>
  );
}

/**
 * The Train landing: one large card for the chosen bot, with everything
 * about it on the card, and avatars to move between the personalities. The chosen
 * bot rides in the address, so every control is a link and it works before
 * hydration.
 */
export function BotSelectorPage({ view }: { readonly view: BotSelector }) {
  const { selected } = view;
  return (
    <TrainPage>
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Train
      </h1>
      <section
        aria-label="Choose an opponent"
        className="mx-auto flex w-full max-w-reading flex-col gap-6"
      >
        <div className="flex items-center gap-4 max-compact:gap-2">
          <Arrow
            href={view.previousHref}
            label="Previous opponent"
            direction="previous"
          />
          <article
            aria-label={`${selected.name}, ${selected.tagline}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-5 rounded-xl bg-surface p-8 text-center shadow-1 max-compact:p-5"
          >
            <div className="portrait-frame overflow-hidden rounded-xl shadow-1">
              <BotPortrait
                id={selected.id}
                look={selected.look}
                label={`${selected.name}, ${selected.tagline}`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-3xl font-bold text-ink">
                {selected.name}
              </h2>
              <p className="text-base text-ink-muted">{selected.tagline}</p>
            </div>
            <p className="text-base text-ink">{selected.personality}</p>
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Icon name="message" size={16} />
              <span>
                <span className="sr-only">Voice: </span>
                {selected.voice}
              </span>
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {selected.traits.map((trait) => (
                <li key={trait}>
                  <Badge>{trait}</Badge>
                </li>
              ))}
            </ul>
            <Link
              href={view.debateHref}
              className={cn(buttonClass('primary'), link, 'w-full')}
            >
              Debate {selected.name}
            </Link>
          </article>
          <Arrow href={view.nextHref} label="Next opponent" direction="next" />
        </div>
        <nav aria-label="All opponents">
          <ul className="flex flex-wrap justify-center gap-3">
            {view.steps.map((step) => (
              <li key={step.bot.id}>
                <Link
                  href={step.href}
                  scroll={false}
                  aria-current={step.selected ? 'true' : undefined}
                  aria-label={step.bot.name}
                  className={cn(
                    'flex rounded-round p-1',
                    link,
                    step.selected
                      ? 'ring-2 ring-accent'
                      : 'opacity-60 hover:opacity-100',
                  )}
                >
                  <span className="block size-12 overflow-hidden rounded-round">
                    <BotPortrait
                      id={step.bot.id}
                      look={step.bot.look}
                      framing="face"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-center text-sm text-ink-muted">
          Training never changes your rating.{' '}
          <Link href={trainDestinations.hub}>Your plan and progress</Link>
        </p>
      </section>
    </TrainPage>
  );
}
