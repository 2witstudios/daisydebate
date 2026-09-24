import Image from 'next/image';
import { art } from '../../assets';

export function HeroBanner() {
  return (
    <section className="relative isolate flex min-h-hero-min items-end justify-between gap-8 overflow-hidden rounded-xl p-10 max-tiles:min-h-hero-min-compact max-tiles:p-6 max-tiny:min-h-hero-min-tiny max-tiny:p-5">
      <Image
        src={art.heroRidge.src}
        alt={art.heroRidge.alt}
        width={art.heroRidge.width}
        height={art.heroRidge.height}
        priority
        sizes="(max-width: 1100px) 100vw, 1180px"
        className="absolute inset-0 -z-2 size-full object-cover object-hero-photo brightness-82 saturate-85"
      />
      <div className="absolute inset-0 -z-1 scrim-hero" aria-hidden="true" />
      <div className="relative flex max-w-hero-content flex-col items-start gap-4">
        <p className="text-xs font-bold tracking-widest text-ink-on-media/80 uppercase">
          Competitive debate
        </p>
        <h1 className="font-display text-display-sm leading-display font-semibold tracking-display text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-3xl">
          Join the marketplace of ideas
        </h1>
        <p className="text-lg text-ink-on-media/85 text-shadow-hero-sub">
          Where ideas compete. The best arguments win.
        </p>
      </div>
      <p className="relative shrink-0 self-center text-right font-display text-md leading-hero-quote text-ink-on-media/80 italic text-shadow-hero-quote max-tiles:hidden">
        &ldquo;Trade arguments.
        <br />
        Earn credibility.&rdquo;
      </p>
    </section>
  );
}
