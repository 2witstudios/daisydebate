'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { art } from '../../assets';

/** Teaser for the Public Beta Open — Daisy's opening tournament, details TBD. */
export function BetaOpenTeaser() {
  return (
    <section className="relative flex min-h-teaser-min items-stretch overflow-hidden rounded-xl border border-border bg-hue-clay-soft text-ink shadow-1">
      <div className="relative z-1 flex shrink grow basis-tournament-body flex-col justify-center gap-2 p-6 max-narrow:basis-full max-narrow:p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
            Public Beta Open
          </h2>
          <Badge tone="accent">Coming soon</Badge>
        </div>
        <p className="font-display text-2xl leading-tight font-semibold tracking-tighter text-balance max-narrow:text-xl">
          Our opening tournament
        </p>
        <p className="text-sm text-ink-muted">
          Dates, format and prize pool TBD.
        </p>
        <Link
          href="/coming-soon/tournaments"
          className={`${buttonClass('secondary')} mt-1 no-underline hover:no-underline`}
        >
          Learn more
        </Link>
      </div>
      <div
        className="relative min-w-0 shrink grow basis-tournament-art before:absolute before:inset-0 before:z-1 before:bg-linear-to-r/srgb before:from-hue-clay-soft before:to-transparent before:to-42% max-narrow:hidden"
        aria-hidden="true"
      >
        <Image
          src={art.laurelArena.src}
          alt=""
          width={art.laurelArena.width}
          height={art.laurelArena.height}
          sizes="(max-width: 900px) 100vw, 460px"
          className="absolute inset-0 size-full object-cover object-tournament-art"
        />
      </div>
    </section>
  );
}
