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
}: {
  readonly requestLink: RequestLinkAction;
}) {
  return (
    <HeroJoin requestLink={requestLink} backdrop={<HeroPhoto hiddenOnPhone />}>
      <h1 className="font-display text-display-sm leading-display font-semibold tracking-display text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-3xl max-narrow:text-ink max-narrow:text-shadow-none">
        The arena for competitive debate
      </h1>
      <p className="text-lg text-ink-on-media/85 text-shadow-hero-sub max-narrow:text-ink-muted max-narrow:text-shadow-none">
        Better arguments. A more thoughtful world.
      </p>
    </HeroJoin>
  );
}
