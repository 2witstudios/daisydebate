import Image from 'next/image';
import { art } from '../../assets';
import type { RequestLinkAction } from '../../auth/sign-in-flow/sign-in-flow';
import { HeroJoin } from './hero-join';

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
    <HeroJoin
      requestLink={requestLink}
      backdrop={
        <>
          <Image
            src={art.heroRidge.src}
            alt={art.heroRidge.alt}
            width={art.heroRidge.width}
            height={art.heroRidge.height}
            priority
            sizes="(max-width: 1100px) 100vw, 1180px"
            className="absolute inset-0 -z-2 size-full object-cover object-hero-photo brightness-82 saturate-85"
          />
          <div
            className="absolute inset-0 -z-1 scrim-hero"
            aria-hidden="true"
          />
        </>
      }
    >
      <p className="text-xs font-bold tracking-widest text-ink-on-media/80 uppercase">
        The #1 place to compete in debate online
      </p>
      <h1 className="font-display text-display-sm leading-display font-semibold tracking-display text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-3xl">
        Debate is a sport now.
      </h1>
      <p className="text-lg text-ink-on-media/85 text-shadow-hero-sub">
        Live 1v1 rounds. Instant verdicts. Ratings on the line. A crowd
        watching.
      </p>
    </HeroJoin>
  );
}
