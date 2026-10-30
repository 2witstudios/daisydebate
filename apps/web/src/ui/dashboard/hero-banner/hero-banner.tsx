import type { RequestLinkAction } from '../../auth/sign-in-flow/sign-in-flow';
import { HeroJoin } from './hero-join';
import { HeroPhoto } from './hero-photo';

/**
 * The signed-out landing hero: the owner's copy and a one-email join that
 * is the sign-in page's own passwordless request (WAIT-2.1).
 */
export function HeroBanner({
  requestLink,
}: {
  readonly requestLink: RequestLinkAction;
}) {
  return (
    <HeroJoin requestLink={requestLink} backdrop={<HeroPhoto />}>
      <h1 className="font-display text-display-sm leading-display font-semibold tracking-display text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-3xl">
        The arena for competitive debate
      </h1>
      <p className="text-lg text-ink-on-media/85 text-shadow-hero-sub">
        Better arguments. A more thoughtful world.
      </p>
    </HeroJoin>
  );
}
