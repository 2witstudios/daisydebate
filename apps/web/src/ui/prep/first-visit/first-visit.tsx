import Link from 'next/link';
import { prepDestinations } from '../../../features/prep/actions';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { LibraryAside } from '../library-aside/library-aside';
import { PrivacyNote } from '../library-aside/privacy-note';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';

const starters: readonly {
  readonly title: string;
  readonly body: string;
  readonly cta: string;
  readonly href: string;
  readonly variant: ButtonVariant;
  readonly symbol: PrepIconName;
  readonly ctaSymbol: PrepIconName;
}[] = [
  {
    title: 'Add an evidence card',
    body: 'Paste text or a link, highlight what you would read aloud, and keep the citation with it.',
    cta: 'Add evidence',
    href: prepDestinations.addEvidence,
    variant: 'primary',
    symbol: 'card',
    ctaSymbol: 'plus',
  },
  {
    title: 'Start a brief',
    body: 'Write a motion, a framing and contentions with claim, warrant and impact.',
    cta: 'New brief',
    href: prepDestinations.newBrief,
    variant: 'secondary',
    symbol: 'doc',
    ctaSymbol: 'plus',
  },
  {
    title: 'Import files',
    body: 'Bring in a document or a PDF and split it into cards. You check each one before it is saved.',
    cta: 'Import source',
    href: prepDestinations.importSource,
    variant: 'secondary',
    symbol: 'upload',
    ctaSymbol: 'upload',
  },
];

const how: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'A card keeps its source',
    body: 'The full text stays under your highlight, so the passage can always be checked.',
  },
  {
    title: 'A brief holds your arguments',
    body: 'Contentions attach cards and show time against the debate rules ([speech time]).',
  },
  {
    title: 'A case turns briefs into speeches',
    body: 'Order them, save versions and take them into a round.',
  },
];

/** The empty library: a hero, three ways to begin, and how the pieces fit. */
export function FirstVisit() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column gap-8 px-6 pt-5 pb-8 max-rail:flex-col max-compact:gap-4 max-compact:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Prep
          </h1>
          <p className="text-base text-ink-muted max-compact:hidden">
            Your debate library: briefs, evidence cards and cases.
          </p>
        </header>
        <section
          aria-labelledby="start-heading"
          className="flex flex-col gap-3 rounded-xl bg-surface-stage px-8 py-8 text-stage-ink max-compact:px-5 max-compact:py-6"
        >
          <h2
            id="start-heading"
            className="font-display text-2xl leading-tight font-bold"
          >
            Start your debate library
          </h2>
          <p className="max-w-prose text-base text-stage-ink-muted">
            Evidence cards, briefs and cases live here, with every source
            attached. Begin with one card. The rest builds from it.
          </p>
        </section>
        <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
          {starters.map((starter) => (
            <li
              key={starter.title}
              className="flex min-h-16 flex-col gap-3 rounded-lg bg-surface-raised p-5 shadow-1"
            >
              <span className="inline-flex size-avatar-lg items-center justify-center rounded-lg bg-accent-soft text-accent">
                <PrepIcon name={starter.symbol} size={20} />
              </span>
              <h3 className="text-md font-bold">{starter.title}</h3>
              <p className="flex-1 text-sm text-ink-muted">{starter.body}</p>
              <Link
                href={starter.href}
                className={`${buttonClass(starter.variant)} no-underline hover:no-underline`}
              >
                <PrepIcon name={starter.ctaSymbol} size={18} />
                {starter.cta}
              </Link>
            </li>
          ))}
        </ul>
        <section
          aria-labelledby="how-heading"
          className="flex flex-col gap-4 rounded-lg bg-surface p-6 shadow-1 max-compact:hidden"
        >
          <h2 id="how-heading" className="text-md font-bold">
            How prep fits together
          </h2>
          <ul className="grid grid-cols-3 gap-6">
            {how.map((step) => (
              <li key={step.title} className="flex flex-col gap-1">
                <h3 className="text-base font-strong">{step.title}</h3>
                <p className="text-sm text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ul>
        </section>
        <PrivacyNote>
          Everything you add is private to you until you share it with a team.
        </PrivacyNote>
      </div>
      <div className="max-compact:hidden">
        <LibraryAside savedSearches={[]} teams={[]} empty />
      </div>
    </div>
  );
}
