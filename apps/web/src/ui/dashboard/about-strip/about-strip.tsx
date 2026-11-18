import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';

const links = [
  { href: '/help', label: 'Help & FAQ' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

/**
 * Home's last row for visitors and members: one line on what Daisy is and
 * the way to About Daisy. A phone shows only the menu (or the join), so it
 * stays off narrow screens like the rows above it.
 */
export function AboutStrip() {
  return (
    <section
      aria-labelledby="about-strip-title"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-border pt-6 max-narrow:hidden"
    >
      <div className="flex max-w-reading min-w-0 flex-col gap-1">
        <h2
          id="about-strip-title"
          className="font-display text-xl font-semibold text-ink"
        >
          Every debater, every league, one venue
        </h2>
        <p className="text-sm leading-normal text-ink-muted">
          Climb the ranked ladder, practise your league’s format, or run your
          whole league on Daisy.
        </p>
      </div>
      <nav
        aria-label="About Daisy"
        className="flex flex-wrap items-center gap-5"
      >
        <Link
          href="/about"
          className={`${buttonClass('secondary')} no-underline hover:no-underline`}
        >
          About Daisy
        </Link>
        {links.map(({ href, label }) => (
          <Link key={href} href={href} className="text-sm">
            {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
