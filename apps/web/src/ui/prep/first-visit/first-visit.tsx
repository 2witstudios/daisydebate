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
  readonly cta: string;
  readonly href: string;
  readonly variant: ButtonVariant;
  readonly symbol: PrepIconName;
  readonly ctaSymbol: PrepIconName;
}[] = [
  {
    title: 'Add an evidence card',
    cta: 'Add evidence',
    href: prepDestinations.addEvidence,
    variant: 'primary',
    symbol: 'card',
    ctaSymbol: 'plus',
  },
  {
    title: 'Start a brief',
    cta: 'New brief',
    href: prepDestinations.newBrief,
    variant: 'secondary',
    symbol: 'doc',
    ctaSymbol: 'plus',
  },
  {
    title: 'Import files',
    cta: 'Import source',
    href: prepDestinations.importSource,
    variant: 'secondary',
    symbol: 'upload',
    ctaSymbol: 'upload',
  },
];

/** The empty library: a hero and three ways to begin. */
export function FirstVisit() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column gap-8 px-6 pt-5 pb-8 max-rail:flex-col max-compact:gap-4 max-compact:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Prep
        </h1>
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
              <h3 className="flex-1 text-md font-bold">{starter.title}</h3>
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
        <PrivacyNote />
      </div>
      <div className="max-compact:hidden">
        <LibraryAside savedSearches={[]} teams={[]} empty />
      </div>
    </div>
  );
}
