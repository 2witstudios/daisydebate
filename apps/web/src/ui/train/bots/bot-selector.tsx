'use client';

import Link from 'next/link';
import type { FormStateAction } from '../../form-action/action-form';
import type { TrainLanding } from '../../../features/train/bots';
import { ActionForm } from '../../form-action/action-form';
import { BotPortrait } from '../../components/bot-portrait/bot-portrait';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainPage } from '../train-page/train-page';
import { portraitLook } from './looks';

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

const difficultyLabels = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
} as const;

/** A chosen opponent: its shipped portrait, or the typographic card. */
function Portrait({ name }: { readonly name: string }) {
  const look = portraitLook(name);
  return look ? (
    <div className="portrait-frame overflow-hidden rounded-xl shadow-1">
      <BotPortrait id={name} look={look} label={`${name}, opponent`} />
    </div>
  ) : (
    <span
      aria-hidden="true"
      className="flex size-16 items-center justify-center rounded-round border border-stage-ink-muted bg-hue-plum font-display text-2xl text-background max-narrow:size-12 max-narrow:text-xl"
    >
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * The Train landing: the real bot roster, one large card for the chosen
 * opponent, and a Start practice post that opens the ordinary Room with
 * that bot seated. Choosing rides in the address, so every control is a
 * link and it works before hydration.
 */
export function BotSelectorPage({
  view,
  action,
  unavailable,
}: {
  readonly view: TrainLanding;
  readonly action: FormStateAction;
  /** The catalog read failed; nothing here can promise a practice. */
  readonly unavailable?: boolean;
}) {
  const { chosen, opponents, available } = view;
  const canPractice = available && chosen?.eligible;
  const chosenIndex = opponents.findIndex((card) => card.selected);
  const previous = chosenIndex > 0 ? opponents[chosenIndex - 1] : null;
  const next =
    chosenIndex >= 0 && chosenIndex < opponents.length - 1
      ? opponents[chosenIndex + 1]
      : null;
  return (
    <TrainPage>
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Train
      </h1>
      <section
        aria-label="Choose an opponent"
        className="mx-auto flex w-full max-w-reading flex-col gap-6"
      >
        {chosen ? (
          <div className="flex items-center gap-4 max-compact:gap-2">
            <Arrow
              href={previous?.href ?? null}
              label="Previous opponent"
              direction="previous"
            />
            <article
              aria-label={`${chosen.name}, opponent`}
              className="flex min-w-0 flex-1 flex-col items-center gap-5 rounded-xl bg-surface p-8 text-center shadow-1 max-compact:p-5"
            >
              <Portrait name={chosen.name} />
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-3xl font-bold text-ink">
                  {chosen.name}
                </h2>
                {chosen.difficulty ? (
                  <p>
                    <Badge>
                      {difficultyLabels[chosen.difficulty] ?? chosen.difficulty}
                    </Badge>
                  </p>
                ) : null}
              </div>
              {chosen.persona ? (
                <p className="text-base text-ink">{chosen.persona}</p>
              ) : null}
              {canPractice ? (
                <ActionForm
                  action={action}
                  label="Start practice"
                  className="w-full"
                >
                  {({ error, pending }) => (
                    <>
                      <input type="hidden" name="bot" value={chosen.actorId} />
                      <button
                        type="submit"
                        disabled={pending}
                        className={cn(buttonClass('primary'), link, 'w-full')}
                      >
                        Start practice
                      </button>
                      {error ? (
                        <p role="alert" className="text-sm text-live">
                          {error}
                        </p>
                      ) : null}
                    </>
                  )}
                </ActionForm>
              ) : (
                <p role="status" className="text-sm text-ink-muted">
                  Practice is unavailable right now: the AI seats are busy or
                  offline.
                </p>
              )}
            </article>
            <Arrow
              href={next?.href ?? null}
              label="Next opponent"
              direction="next"
            />
          </div>
        ) : (
          <p role="status" className="text-center text-ink-muted">
            No opponents are available yet. Check back soon.
          </p>
        )}
        {opponents.length > 1 ? (
          <nav aria-label="All opponents">
            <ul className="flex flex-wrap justify-center gap-3">
              {opponents.map((card) => (
                <li key={card.actorId}>
                  <Link
                    href={card.href}
                    scroll={false}
                    aria-current={card.selected ? 'true' : undefined}
                    aria-label={card.name}
                    className={cn(
                      'flex rounded-round p-1',
                      link,
                      card.selected
                        ? 'ring-2 ring-accent'
                        : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <span className="block size-12 overflow-hidden rounded-round">
                      <Portrait name={card.name} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {unavailable ? (
          <p role="alert" className="text-center text-sm text-ink-muted">
            Practice is unavailable right now. Try again shortly.
          </p>
        ) : null}
      </section>
    </TrainPage>
  );
}
