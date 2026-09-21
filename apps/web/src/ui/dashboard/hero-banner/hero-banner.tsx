import Image from 'next/image';
import { art } from '../../assets';

export function HeroBanner() {
  return (
    <section className="relative isolate flex min-h-hero-min items-end justify-between gap-8 overflow-hidden rounded-lg border border-border p-8 max-tiles:min-h-hero-min-compact max-tiles:p-6 max-tiny:min-h-hero-min-tiny max-tiny:p-5">
      <Image
        src={art.heroRidge.src}
        alt={art.heroRidge.alt}
        fill
        priority
        sizes="(max-width: 1100px) 100vw, 1180px"
        className="-z-2 object-cover object-hero-photo brightness-82 saturate-85"
      />
      <div className="absolute inset-0 -z-1 scrim-hero" aria-hidden="true" />
      <div className="relative flex max-w-hero-content flex-col items-start gap-2">
        <h1 className="text-3xl leading-hero-headline font-black tracking-tighter text-balance text-ink-on-media text-shadow-hero-headline max-tiles:text-2xl">
          Join the marketplace of ideas
        </h1>
        <p className="mt-1 text-lg text-ink-on-media/85 text-shadow-hero-sub">
          Where ideas compete. The best arguments win.
        </p>
      </div>
      <p className="relative self-center text-right font-display text-md leading-hero-quote text-ink-on-media/80 italic text-shadow-hero-quote max-tiles:hidden">
        &ldquo;Trade arguments.
        <br />
        Earn credibility.&rdquo;
      </p>
    </section>
  );
}
