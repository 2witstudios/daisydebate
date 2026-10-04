'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { trainDestinations } from '../../../features/train/actions';
import { selectBotHref, type Bot } from '../../../features/train/bots';
import { MAX_OWN_LENGTH, motions } from '../../../features/train/practice';
import { Badge } from '../../components/badge/badge';
import { BotPortrait } from '../../components/bot-portrait/bot-portrait';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import { cn } from '../../cn';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { Cards, Chips } from '../../train/choice/choices';

export type BotRoomState = {
  readonly notice: string;
  readonly next?: string;
};

const initial: BotRoomState = { notice: '' };

const unreachable = (): BotRoomState => ({
  notice: 'Could not reach Daisy. Check your connection and try again.',
});

const panel = 'flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1';
const plain = 'no-underline hover:no-underline';

function Seat({
  label,
  name,
  detail,
  portrait,
  ready = false,
}: {
  readonly label: string;
  readonly name: string;
  readonly detail: string;
  readonly portrait: ReactNode;
  readonly ready?: boolean;
}) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-surface p-5 shadow-1">
      <span className="block size-16 shrink-0 overflow-hidden rounded-round bg-surface-sunken">
        {portrait}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="text-md font-strong text-ink">{name}</span>
        <span className="text-sm text-ink-muted">{detail}</span>
      </span>
      {ready ? <Badge tone="accent">Ready</Badge> : null}
    </li>
  );
}

/**
 * The room before a debate against a bot: the two seats, the side and the
 * motion, and Start. A real form posting to a server action, so it works
 * before hydration and with JavaScript off; it moves on to the debate.
 */
export function BotRoom({
  bot,
  action,
}: {
  readonly bot: Bot;
  readonly action: FormAction<BotRoomState>;
}) {
  const [state, formAction, pending] = useFormAction(
    action,
    initial,
    unreachable,
  );
  useEffect(() => {
    if (state.next) window.location.assign(state.next);
  }, [state.next]);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <Link
        href={selectBotHref(bot.id)}
        className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">&lsaquo;</span>
        Train
      </Link>
      <PageHeader
        title={`Debate ${bot.name}`}
        lede={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Practice</Badge>
            <Badge tone="neutral">One on one</Badge>
          </span>
        }
      />
      <form
        action={formAction}
        aria-label={`Start a debate against ${bot.name}`}
        className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4"
      >
        <input type="hidden" name="bot" value={bot.id} />
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-compact:w-full max-compact:gap-4">
          <ul aria-label="Seats" className="grid grid-cols-1 gap-4">
            <Seat
              label="Opponent"
              name={bot.name}
              detail={bot.tagline}
              portrait={
                <BotPortrait id={bot.id} look={bot.look} framing="face" />
              }
              ready
            />
            <Seat
              label="Debater"
              name="You"
              detail="By voice: allow your microphone when the debate opens"
              portrait={
                <span className="flex size-full items-center justify-center font-display text-xl font-bold text-ink-muted">
                  You
                </span>
              }
            />
          </ul>
          <section aria-label="Motion" className={panel}>
            <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              Motion
            </h2>
            <Cards
              name="motion"
              legend="Motion"
              value="0"
              options={motions.map((text, index) => ({
                value: String(index),
                title: text,
              }))}
            />
            <label className="flex flex-col gap-2">
              <span className="text-sm font-strong text-ink">
                Or write your own
              </span>
              <input
                type="text"
                name="own"
                maxLength={MAX_OWN_LENGTH}
                className="h-12 rounded-md border border-border bg-surface-raised px-3 text-base text-ink"
              />
            </label>
          </section>
        </div>
        <aside
          aria-label="Start"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <section className={panel}>
            <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              Your side
            </h2>
            <Chips
              name="side"
              legend="Your side"
              value="random"
              options={[
                { value: 'affirmative', label: 'Affirmative' },
                { value: 'negative', label: 'Negative' },
                { value: 'random', label: 'Random' },
              ]}
            />
            <dl className="flex flex-col gap-2 border-t border-border pt-4 text-base">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Format</dt>
                <dd className="font-strong text-ink">
                  One on one, about 35 min
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Your prep</dt>
                <dd className="font-strong text-ink">4:00</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Judge</dt>
                <dd className="font-strong text-ink">AI ballot</dd>
              </div>
            </dl>
            {state.notice ? (
              <p role="alert" className="text-sm text-live">
                {state.notice}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className={cn(buttonClass('primary'), 'w-full')}
            >
              {pending ? 'Starting…' : 'Start debate'}
            </button>
          </section>
          <p className="text-center text-sm text-ink-muted">
            Training never changes your rating.{' '}
            <Link href={trainDestinations.hub} className={plain}>
              Your plan and progress
            </Link>
          </p>
        </aside>
      </form>
    </div>
  );
}
