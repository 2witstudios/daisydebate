import Link from 'next/link';
import { trainDestinations } from '../../../features/train/actions';
import { selectBotHref, type Bot } from '../../../features/train/bots';
import {
  customRulesHref,
  parseCustomRulesQuery,
} from '../../../features/train/custom-rules';
import {
  MAX_OWN_LENGTH,
  OWN_MOTION,
  motions,
  practiceHref,
  practiceSummary,
  type PracticeConfig,
} from '../../../features/train/practice';
import { withPlanContext, type HubQuery } from '../../../features/train/query';
import { buttonClass } from '../../components/button/button-class';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
// The lobby's auto-applying GET form; a shared primitive once a third
// vertical wants it (reported to the parent instead of duplicated).
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { BackLink } from '../back-link/back-link';
import { TrainCard } from '../card/train-card';
import { Cards, Chips } from '../choice/choices';
import { TrainPage } from '../train-page/train-page';

export type PracticeSetupProps = {
  readonly config: PracticeConfig;
  readonly plan: HubQuery;
  /** The bot chosen on the Train landing, if one was. */
  readonly bot?: Bot | null;
};

const link = 'no-underline hover:no-underline';

const onOff = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

/**
 * Set up a practice: side, motion, opponent and pacing in one GET form. The
 * summary beside it is the form's own answer, so it works with no script; a
 * script only applies a choice at once.
 */
export function PracticeSetup({
  config,
  plan,
  bot = null,
}: PracticeSetupProps) {
  const summary = practiceSummary(config);
  const { rules } = config;
  return (
    <TrainPage>
      <BackLink href={withPlanContext(trainDestinations.hub, plan)}>
        Train
      </BackLink>
      <AutoSubmitForm
        action={trainDestinations.practice}
        aria-label="Set up a practice debate"
        className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4"
      >
        <Hidden name="speech" value={String(rules.speechMinutes)} />
        <Hidden name="prep" value={String(rules.prepMinutes)} />
        <Hidden name="seats" value={rules.seats} />
        {bot ? <Hidden name="bot" value={bot.id} /> : null}
        {plan.mins !== 20 ? (
          <Hidden name="mins" value={String(plan.mins)} />
        ) : null}
        {plan.did.length > 0 ? (
          <Hidden name="did" value={plan.did.join(',')} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-compact:w-full">
          {bot ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-4 py-3 text-base text-ink">
              <span>
                Your opponent: <strong>{bot.name}</strong>,{' '}
                {bot.tagline.toLowerCase()}.
              </span>
              <Link href={selectBotHref(bot.id)} className={link}>
                Choose another
              </Link>
            </p>
          ) : null}
          <header className="flex flex-col gap-1">
            <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
              Set up a practice debate
            </h1>
            <p className="text-base text-ink-muted">
              Pick a side, a motion, an opponent and how you want to be paced.
              You can start in under a minute.
            </p>
          </header>
          <TrainCard title="Your side">
            <p className="text-sm text-ink-muted">
              Aff argues for the motion. Neg argues against it.
            </p>
            <Chips
              name="side"
              legend="Side"
              value={config.side}
              options={[
                { value: 'aff', label: 'Aff (Affirmative)' },
                { value: 'neg', label: 'Neg (Negative)' },
                { value: 'random', label: 'Random' },
              ]}
            />
          </TrainCard>
          <TrainCard title="Motion">
            <p className="text-sm text-ink-muted">
              Sample motions. Pick one or write your own.
            </p>
            <Cards
              name="motion"
              legend="Motion"
              value={String(config.motion)}
              options={[
                ...motions.map((text, index) => ({
                  value: String(index),
                  title: text,
                })),
                { value: String(OWN_MOTION), title: 'Write my own' },
              ]}
            />
            {config.motion === OWN_MOTION ? (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="own-motion"
                  className="text-sm font-strong text-ink"
                >
                  Your motion
                </label>
                <input
                  id="own-motion"
                  type="text"
                  name="own"
                  defaultValue={config.own}
                  maxLength={MAX_OWN_LENGTH}
                  className="h-12 rounded-md border border-border bg-surface-raised px-3 text-base text-ink"
                />
              </div>
            ) : null}
          </TrainCard>
          <TrainCard title="Opponent">
            <p className="text-sm text-ink-muted">
              Practice debates never need another person.
            </p>
            <Cards
              name="opp"
              legend="Opponent"
              value={config.opponent}
              options={[
                {
                  value: 'ai',
                  title: 'AI debater',
                  description:
                    'An AI debater takes the other side and answers your points. It sits in a sandbox seat, not as a person.',
                },
                {
                  value: 'both',
                  title: 'Drive both sides',
                  description:
                    'You give every speech from two seats. Good for testing a case against itself.',
                },
                {
                  value: 'solo',
                  title: 'Solo speeches',
                  description:
                    'Only your seat. The clock and prompts run, and nobody answers.',
                },
              ]}
            />
          </TrainCard>
          <TrainCard title="Pacing">
            <p className="text-sm text-ink-muted">
              How much help you get while you speak.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex flex-col">
                <span className="text-base font-strong text-ink">
                  Coach prompts
                </span>
                <span className="text-sm text-ink-muted">
                  Shows what to cover in each speech.
                </span>
              </p>
              <Chips
                name="coach"
                legend="Coach prompts"
                value={config.coach ? 'on' : 'off'}
                options={onOff}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex flex-col">
                <span className="text-base font-strong text-ink">Hints</span>
                <span className="text-sm text-ink-muted">
                  Reveal a hint when you are stuck. Free in practice.
                </span>
              </p>
              <Chips
                name="hints"
                legend="Hints"
                value={config.hints ? 'on' : 'off'}
                options={onOff}
              />
            </div>
          </TrainCard>
        </div>
        <aside
          aria-label="Your practice"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <TrainCard title="Your practice">
            <Badge tone="accent">Practice · Unrated</Badge>
            <dl className="flex flex-col gap-3">
              {summary.rows.map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs font-bold tracking-wider text-ink-faint uppercase">
                    {label}
                  </dt>
                  <dd className="text-base text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-ink-muted">{summary.note}</p>
            <p className="rounded-md bg-surface-sunken p-3 text-sm text-ink-muted">
              This never changes your rating. Ranked debates are played against
              people, on the standard rules.
            </p>
            <button type="submit" className={cn(buttonClass('secondary'))}>
              Update summary
            </button>
            <Link
              href={practiceHref(trainDestinations.practiceLive, config, plan)}
              className={cn(buttonClass('primary'), link)}
            >
              Start practice
            </Link>
            <Link
              href={customRulesHref({
                ...parseCustomRulesQuery({}),
                rules: config.rules,
                plan,
              })}
              className={cn(buttonClass('ghost'), link)}
            >
              Use custom rules for this practice
            </Link>
          </TrainCard>
        </aside>
      </AutoSubmitForm>
    </TrainPage>
  );
}
