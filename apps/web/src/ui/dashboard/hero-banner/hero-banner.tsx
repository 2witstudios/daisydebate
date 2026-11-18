import Link from 'next/link';
import type { RequestLinkAction } from '../../auth/sign-in-flow/sign-in-flow';
import { HeroJoin } from './hero-join';
import { HeroPhoto } from './hero-photo';

/**
 * The signed-out landing hero: the owner's copy and a one-email join that
 * is the sign-in page's own passwordless request (WAIT-2.1). On a phone it
 * drops the photograph and sits plainly on the page.
 */
export function HeroBanner({
  requestLink,
  showPricing = false,
}: {
  readonly requestLink: RequestLinkAction;
  /** Whether /pricing is open, so the hero links to it. */
  readonly showPricing?: boolean;
}) {
  return (
    <HeroJoin
      requestLink={requestLink}
      backdrop={<HeroPhoto hiddenOnPhone />}
      footer={
        <Link
          href="/about"
          className="text-base font-strong text-ink-on-media underline max-narrow:text-ink"
        >
          Learn about Daisy
        </Link>
      }
    >
      <h1 className="font-display text-display-sm leading-display font-semibold tracking-display text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-3xl max-narrow:text-ink max-narrow:text-shadow-none">
        The arena for competitive debate
      </h1>
      <p className="text-lg text-ink-on-media/85 text-shadow-hero-sub max-narrow:text-ink-muted max-narrow:text-shadow-none">
        Better arguments. A more thoughtful world.
      </p>
      {showPricing ? (
        <Link
          href="/pricing"
          className="text-ink-on-media underline text-shadow-hero-sub max-narrow:text-ink max-narrow:text-shadow-none"
        >
          Plans and pricing
        </Link>
      ) : null}
    </HeroJoin>
  );
}
